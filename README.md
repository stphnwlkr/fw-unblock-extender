# Unblock Extender

Unblock Extender adds class and variable autocomplete, CSS recipes, and editor shortcuts to Unblock. Automatic.css is optional and detected automatically when active.

- Search for classes and variables from Unblock and Automatic.css in the sidebar and code editors.
- Type `?` in the CSS editor to find recipes, or type a full trigger such as `?card-stack;` to expand it.
- Add and import site-wide recipes from the sidebar as a site administrator.
- Open a block's options in List View and look for the **Unblock** group. **Insert** appends an Unblock block inside the selected block when it accepts children. **Wrap in** places the selection inside an Unblock wrapper. On a Group, **Convert to Section** replaces the Group with an Unblock Section, places its children in the Section's default Container, and preserves the Group's HTML anchor, custom classes, and editor name. The new wrappers use Unblock's default layout and styles.
- **Convert to Unblock** converts supported WordPress blocks and their eligible children into editable Unblock elements. Select one block or adjacent supported blocks in List View. Dynamic children such as Query Loop keep their WordPress behavior. Some theme styles may need to be reapplied.
- Press Ctrl+S or Cmd+S in the code editor to save through WordPress.

## Installation and updates

Requires WordPress 7.1 or later, PHP 8.4 or later, and the Unblock plugin for editor features.

1. [Download the latest release ZIP](https://github.com/stphnwlkr/fw-unblock-extender/releases/latest/download/fw-unblock-extender.zip).
2. In WordPress, go to **Plugins → Add Plugin → Upload Plugin**. Install and activate Unblock Extender. If upgrading from 0.4.0, replace the existing installation when prompted. If upgrading from Uplink ACSS for Unblock, deactivate that plugin first.
3. Open **Unblock Extender** in the block editor toolbar.

Starting with 0.5.0, stable GitHub releases appear in the WordPress **Plugins** and **Dashboard → Updates** screens. Use **Update now**, or enable automatic updates for this plugin in WordPress. The plugin checks public release metadata on GitHub. Editor data and recipes stay on the WordPress site.

See [RELEASING.md](RELEASING.md) for publishing instructions. Licensed under GPL-2.0-or-later.

## Automatic.css button styles and cascade layers

Unblock's section reset tells links with a class to inherit text color and decoration. When Automatic.css (ACSS) puts its button rules inside a CSS layer, the unlayered reset can win before the browser compares selector specificity.

Unblock Extender restores the ACSS text color and decoration tokens on links with a `btn--` class inside Unblock sections, including hover and keyboard focus. The fix works with ACSS layers enabled or disabled.

If button text still looks wrong, open the ACSS dashboard and go to **Options → Layer Controls**. Turn off **Buttons & Links**, save, and recheck the button on the front end and in the editor. This removes the layer from those rules while keeping the button styles enabled.

For a similar conflict, inspect the affected property in your browser's **Styles** panel. If an unlayered declaration overrides a layered ACSS rule, toggle only the layer for that feature and check the result. When reporting a conflict, include the affected property, both selectors, and the ACSS layer name.

## Warranty

Unblock Extender is provided as is, without warranty of any kind, express or implied, including the implied warranties of merchantability and fitness for a particular purpose.
