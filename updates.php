<?php

declare( strict_types=1 );

namespace Uplink\Unblock_Extender;

defined( 'ABSPATH' ) || exit;

const RELEASE_REPOSITORY = 'https://github.com/stphnwlkr/fw-unblock-extender';

add_filter( 'update_plugins_github.com', __NAMESPACE__ . '\\github_update', 10, 3 );
add_filter( 'plugins_api', __NAMESPACE__ . '\\github_plugin_information', 10, 3 );

/**
 * Offer the published release to the standard WordPress plugin updater.
 */
function github_update( mixed $update, array $plugin_data, string $plugin_file ): mixed {
	if ( plugin_basename( __DIR__ . '/fw-unblock-extender.php' ) !== $plugin_file
		|| RELEASE_REPOSITORY !== ( $plugin_data['UpdateURI'] ?? '' ) ) {
		return $update;
	}

	$release = github_release();
	if ( ! $release || version_compare( $release['version'], $plugin_data['Version'], '<' ) ) {
		return $update;
	}

	return array(
		'slug'         => HANDLE,
		'version'      => $release['version'],
		'url'          => RELEASE_REPOSITORY . '/releases/tag/' . $release['version'],
		'package'      => $release['download_url'],
		'requires'     => $release['requires'],
		'requires_php' => $release['requires_php'],
		'tested'       => $release['tested'],
	);
}

/**
 * Provide release notes and compatibility information in WordPress's details modal.
 */
function github_plugin_information( mixed $result, string $action, object $args ): mixed {
	if ( false !== $result || 'plugin_information' !== $action || HANDLE !== ( $args->slug ?? '' ) ) {
		return $result;
	}

	$release = github_release();
	if ( ! $release ) {
		return $result;
	}

	return (object) array(
		'name'          => 'Unblock Extender',
		'slug'          => HANDLE,
		'version'       => $release['version'],
		'homepage'      => RELEASE_REPOSITORY,
		'download_link' => $release['download_url'],
		'requires'      => $release['requires'],
		'requires_php'  => $release['requires_php'],
		'tested'        => $release['tested'],
		'sections'      => array(
			'description' => esc_html__( 'Extends Unblock with class and variable lookup, custom CSS recipes, and editor shortcuts.', 'fw-unblock-extender' ),
			'changelog'   => wpautop( esc_html( $release['changelog'] ) ),
		),
	);
}

/**
 * Read the manifest attached to the latest stable release.
 */
function github_release(): ?array {
	static $requested = false;
	static $release   = null;

	if ( $requested ) {
		return $release;
	}

	$requested = true;
	$response  = wp_safe_remote_get(
		RELEASE_REPOSITORY . '/releases/latest/download/update.json',
		array(
			'timeout'             => 5,
			'limit_response_size' => 32 * KB_IN_BYTES,
			'headers'             => array( 'Accept' => 'application/json' ),
		)
	);

	if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
		return null;
	}

	$manifest = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( ! is_array( $manifest ) || HANDLE !== ( $manifest['slug'] ?? '' ) ) {
		return null;
	}

	foreach ( array( 'version', 'requires', 'requires_php', 'tested' ) as $key ) {
		if ( ! is_string( $manifest[ $key ] ?? null ) || ! preg_match( '/\A\d+\.\d+(?:\.\d+)?\z/', $manifest[ $key ] ) ) {
			return null;
		}
	}

	$package = RELEASE_REPOSITORY . '/releases/download/' . $manifest['version'] . '/' . HANDLE . '.zip';
	if ( $package !== ( $manifest['download_url'] ?? '' ) || ! is_string( $manifest['changelog'] ?? null ) ) {
		return null;
	}

	$release = $manifest;
	return $release;
}
