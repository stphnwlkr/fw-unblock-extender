=== Unblock Extender ===
Requires at least: 7.1
Tested up to: 7.2
Requires PHP: 8.4
Stable tag: 0.5.0
License: GPL-2.0-or-later

Adds class and variable lookup, CSS recipes, and editor shortcuts to Unblock.

== Description ==

Unblock Extender reads Unblock's class and variable registry. If Automatic.css is active, its generated classes, variables, and recipes appear automatically.

Site administrators can add CSS recipes or import a JSON file from the Recipes panel. Recipes are shared across the site. To expand a recipe, type its name with a leading question mark and a trailing semicolon inside a CSS rule. For example, type `?card-stack;`. Use `%root%` where a recipe needs to refer to the current selector.

== Recipe import ==

Import an array of name and code entries, for example:

`[{"name":"card-stack","code":"display: grid;\ngap: 1rem;"}]`

The import also accepts an object with a recipes array or an ACSS-style expansions object. Existing custom recipes are preserved. If a custom recipe and an ACSS recipe share a name, the custom recipe is used.

== Upgrading from Uplink ACSS for Unblock ==

Deactivate the old plugin, install Unblock Extender, and activate it. The new plugin uses the fw-unblock-extender folder.

== Updates ==

Install version 0.5.0 or later once from the GitHub release ZIP. New stable releases then appear under Plugins and Dashboard > Updates. WordPress can also install them automatically if you enable auto-updates for this plugin. WordPress requests public release metadata from GitHub. Editor data and custom recipes stay on the WordPress site.

== Changelog ==

= 0.5.0 =
* Added WordPress admin updates from public GitHub Releases.
