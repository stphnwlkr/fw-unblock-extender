=== Unblock Extender ===
Requires at least: 7.1
Tested up to: 7.2
Requires PHP: 8.4
Stable tag: 0.8.0
License: GPL-2.0-or-later

Adds class and variable lookup, CSS recipes, and editor shortcuts to Unblock.

== Description ==

Unblock Extender reads Unblock's class and variable registry. If Automatic.css is active, its generated classes, variables, and recipes appear automatically.

Site administrators can add CSS recipes or import a JSON file from the Recipes panel. Recipes are shared across the site. To expand a recipe, type its name with a leading question mark and a trailing semicolon inside a CSS rule. For example, type `?card-stack;`. Use `%root%` where a recipe needs to refer to the current selector.

In List View, open a block's options and look for the Unblock group. Use Insert to append a child inside the selected block, or Wrap in to enclose the selection in an Unblock wrapper. On a Group, Convert to Section puts the Group's children in the Section's default Container and carries the Group's HTML anchor, custom classes, and editor name to the Section. The new wrappers use Unblock's default layout and styles.

Choose Convert to Unblock to turn supported WordPress blocks into editable Unblock elements. This works on a single block or a contiguous selection of supported sibling blocks. Nested blocks with dynamic behavior, such as Query Loop, stay in place. Theme styles attached to the original block type may need to be reapplied.

== Recipe import ==

Import an array of name and code entries, for example:

`[{"name":"card-stack","code":"display: grid;\ngap: 1rem;"}]`

The import also accepts an object with a recipes array or an ACSS-style expansions object. Existing custom recipes are preserved. If a custom recipe and an ACSS recipe share a name, the custom recipe is used.

== Upgrading from Uplink ACSS for Unblock ==

Deactivate the old plugin, install Unblock Extender, and activate it. The new plugin uses the fw-unblock-extender folder.

== Updates ==

Install version 0.5.0 or later once from the GitHub release ZIP. New stable releases then appear under Plugins and Dashboard > Updates. WordPress can also install them automatically if you enable auto-updates for this plugin. WordPress requests public release metadata from GitHub. Editor data and custom recipes stay on the WordPress site.

== Warranty ==

Unblock Extender is provided as is, without warranty of any kind, express or implied, including the implied warranties of merchantability and fitness for a particular purpose.

== Changelog ==

= 0.8.0 =
* Added Convert to Unblock to the block options menu for supported WordPress blocks.

= 0.7.1 =
* Changed Insert to append inside the selected block where children are supported.
* Added Unblock icons and positioned the menu group beside the WordPress grouping actions.

= 0.7.0 =
* Added Insert and Wrap in flyouts to the Unblock group in the block options menu.
* Renamed the Group conversion to Convert to Section. It uses the Section's default Container.

= 0.6.0 =
* Added a Group block menu action that converts it to an Unblock Section and Container.

= 0.5.1 =
* Corrected translation metadata for recipe imports and documented atomic recipe writes.
* Added a no-warranty statement and a required Plugin Check step for GitHub releases.

= 0.5.0 =
* Added WordPress admin updates from public GitHub Releases.
