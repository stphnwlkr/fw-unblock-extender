<?php
/**
 * Plugin Name: Unblock Extender
 * Description: Extends Unblock with class and variable lookup, custom CSS recipes, and editor shortcuts.
 * Version: 0.5.0
 * Requires at least: 7.1
 * Requires PHP: 8.4
 * Plugin URI: https://github.com/stphnwlkr/fw-unblock-extender
 * Update URI: https://github.com/stphnwlkr/fw-unblock-extender
 * Author: Uplink Plugins
 * License: GPL-2.0-or-later
 * Text Domain: fw-unblock-extender
 */

declare( strict_types=1 );

namespace Uplink\Unblock_Extender;

use Automatic_CSS\API;
use Automatic_CSS\Model\Config\Expansion;
use Automatic_CSS\Model\Generated_Inventory;

defined( 'ABSPATH' ) || exit;

const VERSION = '0.5.0';
const HANDLE  = 'fw-unblock-extender';

require_once __DIR__ . '/recipes.php';
require_once __DIR__ . '/updates.php';

add_action( 'enqueue_block_editor_assets', __NAMESPACE__ . '\\enqueue_editor', 20 );
add_action( 'plugins_loaded', static function (): void {
	remove_action( 'enqueue_block_editor_assets', 'Uplink\\ACSS_For_Unblock\\enqueue_editor', 20 );
} );

/**
 * Load the recipe library and the ACSS catalog when ACSS is available.
 */
function enqueue_editor(): void {
	if ( ! defined( 'UNBK_VERSION' ) ) {
		return;
	}

	$inventory = class_exists( Generated_Inventory::class ) ? new Generated_Inventory() : null;
	$can_manage_recipes = current_user_can( 'manage_options' );
	$catalog = array(
		'acssAvailable' => null !== $inventory || class_exists( API::class ),
		'variables'     => $inventory ? variable_names( $inventory->get_variables() ) : array(),
		'classes'       => $inventory ? valid_names( $inventory->get_classes(), '/\A[A-Za-z_-][A-Za-z0-9_-]*\z/' ) : array(),
		'recipes'       => css_recipes(),
		'customRecipes' => saved_recipes(),
		'recipeRoute'   => $can_manage_recipes ? RECIPE_ROUTE : null,
	);

	$json = wp_json_encode( $catalog, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );
	if ( false === $json ) {
		return;
	}

	$unblock_prefix = defined( 'UNBK_SLUG' ) ? UNBK_SLUG : 'unblock';
	$dependencies   = array( 'wp-api-fetch', 'wp-block-editor', 'wp-blocks', 'wp-components', 'wp-core-data', 'wp-data', 'wp-editor', 'wp-element', 'wp-i18n', 'wp-plugins' );
	if ( wp_script_is( $unblock_prefix . '-core', 'registered' ) ) {
		$dependencies[] = $unblock_prefix . '-core';
	}

	wp_enqueue_style( HANDLE, plugins_url( 'assets/editor.css', __FILE__ ), array( 'wp-components' ), VERSION );
	wp_enqueue_script(
		HANDLE,
		plugins_url( 'assets/editor.js', __FILE__ ),
		$dependencies,
		VERSION,
		true
	);
	wp_add_inline_script( HANDLE, 'window.fwUnblockExtender = ' . $json . ';', 'before' );
	wp_set_script_translations( HANDLE, 'fw-unblock-extender' );

	$code_editor = $unblock_prefix . '-code-editor';
	if ( wp_script_is( $code_editor, 'registered' ) ) {
		wp_enqueue_script(
			HANDLE . '-code',
			plugins_url( 'assets/code-completions.js', __FILE__ ),
			array( HANDLE, $code_editor ),
			VERSION,
			true
		);
		wp_set_script_translations( HANDLE . '-code', 'fw-unblock-extender' );
	}
}

/**
 * ACSS inventory entries omit the custom property's leading dashes.
 * Accept prefixed entries too so both forms share a single catalog entry.
 */
function variable_names( array $names ): array {
	$names = array_map(
		static fn( $name ) => is_string( $name ) && ! str_starts_with( $name, '--' ) ? '--' . $name : $name,
		$names
	);

	return valid_names( $names, '/\A--[A-Za-z0-9_-]+\z/' );
}

/**
 * Keep literal names suitable for use in a class attribute or var().
 */
function valid_names( array $names, string $pattern ): array {
	$names = array_filter( $names, static fn( $name ) => is_string( $name ) && preg_match( $pattern, $name ) );
	$names = array_values( array_unique( $names ) );
	sort( $names, SORT_NATURAL | SORT_FLAG_CASE );
	return $names;
}

/**
 * ACSS expands JavaScript and placeholder text through the same API as CSS.
 * Exclude the entries from those two groups by their configured names.
 */
function css_recipes(): array {
	if ( ! is_callable( array( API::class, 'get_all_recipes' ) ) || ! class_exists( Expansion::class ) ) {
		return array();
	}

	try {
		$recipes = API::get_all_recipes();
		foreach ( array( 'js-expansions', 'ipsum-expansions' ) as $group ) {
			$config  = ( new Expansion( $group ) )->load();
			$recipes = array_diff_key( $recipes, $config['expansions'] ?? array() );
		}
	} catch ( \Throwable $exception ) {
		return array();
	}

	ksort( $recipes, SORT_NATURAL | SORT_FLAG_CASE );

	$result = array();
	foreach ( $recipes as $name => $code ) {
		if ( is_string( $name ) && is_string( $code ) && '' !== trim( $code ) ) {
			$result[] = array( 'name' => $name, 'code' => $code );
		}
	}

	return $result;
}
