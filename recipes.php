<?php
/**
 * Site recipe library and authenticated writes.
 */

declare( strict_types=1 );

namespace Uplink\Unblock_Extender;

defined( 'ABSPATH' ) || exit;

const RECIPE_OPTION = 'fw_unblock_extender_recipes';
const RECIPE_ROUTE  = '/fw-unblock-extender/v1/recipes';

add_action( 'rest_api_init', __NAMESPACE__ . '\\register_recipe_route' );

function register_recipe_route(): void {
	register_rest_route(
		'fw-unblock-extender/v1',
		'/recipes',
		array(
			'methods'             => \WP_REST_Server::CREATABLE,
			'permission_callback' => static fn() => current_user_can( 'manage_options' ),
			'callback'            => __NAMESPACE__ . '\\add_recipes',
		)
	);
}

function saved_recipes(): array {
	$recipes = json_decode( (string) get_option( RECIPE_OPTION, '[]' ), true );
	return is_array( $recipes ) && array_is_list( $recipes ) ? $recipes : array();
}

function recipe_error( string $message, int $status = 400 ): \WP_Error {
	return new \WP_Error( 'fw_unblock_extender_recipes', $message, array( 'status' => $status ) );
}

/**
 * Normalize the import formats into a list of name/CSS pairs.
 */
function import_entries( mixed $input ): array|\WP_Error {
	if ( ! is_array( $input ) ) {
		return recipe_error( __( 'Import a JSON array of recipes or an ACSS expansions object.', 'fw-unblock-extender' ) );
	}
	if ( array_key_exists( 'recipes', $input ) ) {
		$input = $input['recipes'];
	}
	if ( is_array( $input ) && array_is_list( $input ) ) {
		return $input;
	}
	if ( ! is_array( $input ) || ! is_array( $input['expansions'] ?? null ) ) {
		return recipe_error( __( 'The JSON does not contain a recipe list.', 'fw-unblock-extender' ) );
	}
	if ( count( $input['expansions'] ) > 100 ) {
		return recipe_error( __( 'Add or import between 1 and 100 recipes at a time.', 'fw-unblock-extender' ) );
	}

	$entries = array();
	foreach ( $input['expansions'] as $name => $entry ) {
		$code = is_array( $entry ) ? ( $entry['expandTo'] ?? null ) : $entry;
		if ( is_array( $entry ) && isset( $entry['wrapIn'] ) ) {
			$key = $entry['wrapIn'];
			$wrapper = is_string( $key ) && is_array( $input['wrappers'] ?? null )
				? ( $input['wrappers'][ $key ] ?? null )
				: null;
			if ( ! is_string( $wrapper ) || ! is_string( $code ) || ! str_contains( $wrapper, '@slot@' ) ) {
				return recipe_error( __( 'An imported recipe references a missing or invalid wrapper.', 'fw-unblock-extender' ) );
			}
			if ( strlen( $wrapper ) + substr_count( $wrapper, '@slot@' ) * ( strlen( $code ) - 6 ) > 32000 ) {
				return recipe_error( __( 'An imported recipe is too large after applying its wrapper.', 'fw-unblock-extender' ) );
			}
			$code = str_replace( '@slot@', $code, $wrapper );
		}
		$entries[] = array( 'name' => $name, 'code' => $code );
	}

	return $entries;
}

/**
 * Validate the entire batch before writing so an invalid import leaves the library intact.
 */
function normalize_recipes( array $entries ): array|\WP_Error {
	if ( ! $entries || count( $entries ) > 100 ) {
		return recipe_error( __( 'Add or import between 1 and 100 recipes at a time.', 'fw-unblock-extender' ) );
	}

	$recipes = array();
	foreach ( $entries as $index => $entry ) {
		$name = is_array( $entry ) && is_string( $entry['name'] ?? null ) ? strtolower( trim( $entry['name'] ) ) : '';
		$name = str_starts_with( $name, '?' ) ? substr( $name, 1 ) : $name;
		$code = is_array( $entry ) && is_string( $entry['code'] ?? null ) ? trim( $entry['code'] ) : '';
		if ( ! preg_match( '/\A[a-z0-9][a-z0-9_-]{0,63}\z/', $name ) || '' === $code ||
			strlen( $code ) > 32000 || str_contains( $code, "\0" ) || ! preg_match( '//u', $code ) ) {
			return recipe_error(
				sprintf(
					/* translators: %d: recipe number in the submitted list. */
					__( 'Recipe %d needs a valid name and nonempty CSS up to 32,000 bytes.', 'fw-unblock-extender' ),
					$index + 1
				)
			);
		}
		if ( isset( $recipes[ $name ] ) ) {
			return recipe_error(
				sprintf(
					/* translators: %s: CSS recipe name. */
					__( 'The import contains more than one recipe named “%s”.', 'fw-unblock-extender' ),
					$name
				)
			);
		}
		$recipes[ $name ] = array( 'name' => $name, 'code' => $code );
	}

	return $recipes;
}

function add_recipes( \WP_REST_Request $request ): array|\WP_Error {
	global $wpdb;

	if ( strlen( $request->get_body() ) > 1100000 ) {
		return recipe_error( __( 'The recipe import is too large.', 'fw-unblock-extender' ), 413 );
	}
	$entries = import_entries( $request->get_json_params() );
	if ( is_wp_error( $entries ) ) {
		return $entries;
	}
	$incoming = normalize_recipes( $entries );
	if ( is_wp_error( $incoming ) ) {
		return $incoming;
	}

	$stored = get_option( RECIPE_OPTION, null );
	$current = null === $stored ? array() : json_decode( (string) $stored, true );
	if ( ! is_array( $current ) || ! array_is_list( $current ) ) {
		return recipe_error( __( 'The saved recipe library could not be read.', 'fw-unblock-extender' ), 500 );
	}

	foreach ( $current as $recipe ) {
		if ( isset( $incoming[ $recipe['name'] ] ) ) {
			return recipe_error(
				sprintf(
					/* translators: %s: CSS recipe name. */
					__( 'A custom recipe named “%s” already exists.', 'fw-unblock-extender' ),
					$recipe['name']
				),
				409
			);
		}
	}
	$recipes = array_merge( $current, array_values( $incoming ) );
	$value   = wp_json_encode( $recipes );
	if ( false === $value || count( $recipes ) > 300 || strlen( $value ) > 1000000 ) {
		return recipe_error( __( 'The site recipe library is full.', 'fw-unblock-extender' ), 413 );
	}

	// The Options API does not support atomic insert-if-absent or compare-and-swap.
	if ( null === $stored ) {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Insert only if the option is still absent, then invalidate the option caches below.
		$result = $wpdb->query(
			$wpdb->prepare(
				"INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'off')",
				RECIPE_OPTION,
				$value
			)
		);
	} else {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Update only if the recipe snapshot is unchanged, then invalidate the option cache below.
		$result = $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s",
				$value,
				RECIPE_OPTION,
				$stored
			)
		);
	}
	if ( false === $result ) {
		return recipe_error( __( 'WordPress could not save the recipes.', 'fw-unblock-extender' ), 500 );
	}
	wp_cache_delete( RECIPE_OPTION, 'options' );
	if ( null === $stored ) {
		wp_cache_delete( 'notoptions', 'options' );
	}
	if ( 0 === $result ) {
		return recipe_error( __( 'The recipe library changed while saving. Try again.', 'fw-unblock-extender' ), 409 );
	}

	return array( 'recipes' => $recipes, 'added' => count( $incoming ) );
}
