(function (wp, catalog) {
	'use strict';

	const { Button, MenuGroup, MenuItem, NavigableMenu, Popover, SearchControl, SelectControl, TextareaControl, TextControl } = wp.components;
	const { createElement: h, createPortal, Fragment, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } = wp.element;
	const { __, isRTL, sprintf } = wp.i18n;
	const { useSelect, useRegistry, select, dispatch } = wp.data;
	const {
		cloneBlock, createBlock, createBlocksFromInnerBlocksTemplate, getBlockType, hasBlockSupport, serialize, store: blocksStore,
	} = wp.blocks;
	const { PluginSidebar } = wp.editor;
	const { BlockIcon, BlockSettingsMenuControls, store: blockEditor } = wp.blockEditor;
	const domain = 'fw-unblock-extender';
	const pageSize = 25;
	const title = __('Unblock Extender', domain);
	const sourceNames = {
		acss: 'ACSS',
		unblock: 'Unblock',
		both: 'ACSS + Unblock',
		custom: __('Custom', domain),
	};

	const groups = {
		variables: __('Variables', domain),
		classes: __('Classes', domain),
		recipes: __('Recipes', domain),
	};

	const recipes = catalog.recipes.map(({ name, code }) => ({
		name: '?' + name,
		code: code.replaceAll('%root%', '&'),
		source: 'acss',
		detail: sourceNames.acss,
	}));
	const registryKeys = { variables: 'unbk_css_variables', classes: 'unbk_css_selectors' };
	const cache = {};

	function getRegistry(core) {
		if (!core?.getEntityConfig?.('unblock', 'css')) {
			return null;
		}
		const saved = core.getEntityRecord('unblock', 'css', 'css');
		return core.getEditedEntityRecord('unblock', 'css', 'css') ?? saved;
	}

	function getEntries(group, core = select('core')) {
		if (group === 'recipes') {
			const records = catalog.customRecipes;
			if (cache.recipes && cache.recipes.records === records) {
				return cache.recipes.items;
			}
			const entries = new Map(recipes.map((recipe) => [recipe.name, recipe]));
			for (const { name, code } of records ?? []) {
				entries.set('?' + name, {
					name: '?' + name,
					code: code.replaceAll('%root%', '&'),
					source: 'custom',
					detail: sourceNames.custom,
				});
			}
			const items = Array.from(entries.values()).sort((first, second) => first.name.localeCompare(second.name));
			cache.recipes = { records, items };
			return items;
		}

		const records = getRegistry(core)?.[registryKeys[group]];
		if (cache[group] && cache[group].records === records) {
			return cache[group].items;
		}

		const variables = group === 'variables';
		const entries = new Map(catalog[group].map((name) => [name, { name, source: 'acss' }]));
		const decode = window.Unblock?.core?.decodeCSSSelector;
		for (const [id, record] of Object.entries(records ?? {})) {
			if (!record || record.enabled === false || (!variables && record.type !== 'class')) {
				continue;
			}

			const selector = typeof record.selector === 'string' ? record.selector : '';
			const name = variables ? record.name : (decode?.(selector) ?? selector.slice(1));
			if (typeof name !== 'string' || (variables
				? !/^--[\w\u0080-\uFFFF-]+$/.test(name)
				: !selector.startsWith('.') || !name || /[\s<>"'{}]/.test(name))) {
				continue;
			}

			const existing = entries.get(name);
			entries.set(name, {
				name,
				source: existing?.source === 'acss' || existing?.source === 'both' ? 'both' : 'unblock',
				unblockId: variables ? undefined : id,
				global: (record.scope ?? 'global') === 'global',
			});
		}

		const items = Array.from(entries.values(), (item) => ({
			...item,
			code: variables ? 'var(' + item.name + ')' : item.name,
			detail: sourceNames[item.source],
		})).sort((first, second) => first.name.localeCompare(second.name, undefined, { numeric: true }));
		cache[group] = { records, items };
		return items;
	}

	catalog.getEntries = getEntries;

	function classTarget(editor) {
		const block = editor.getSelectedBlock();
		if (!block || editor.hasMultiSelection?.()) {
			return null;
		}

		const mode = editor.getBlockEditingMode?.(block.clientId);
		if (mode && mode !== 'default') {
			return null;
		}

		if (block.name === 'unblock/element') {
			const attrs = block.attributes.attrs ?? {};
			const classValue = attrs.class ?? '';
			// Preserve Unblock selector IDs and leave Twig class expressions to the HTML Inspector.
			if (typeof classValue !== 'string' || /\{[{%#]/.test(classValue)) {
				return null;
			}

			return { id: block.clientId, classValue, attrs, styles: block.attributes.styles ?? [] };
		}

		const type = getBlockType(block.name);
		if (!type?.attributes?.className || !hasBlockSupport(type, 'customClassName', true)) {
			return null;
		}

		return { id: block.clientId, classValue: block.attributes.className ?? '' };
	}

	function classNames(value) {
		return value.trim().split(/\s+/).filter(Boolean);
	}

	const elementBlock = 'unblock/element';
	const conditionBlock = 'unblock/condition';
	const loopBlock = 'unblock/loop';
	const insertableBlockTypes = [elementBlock, conditionBlock, loopBlock];
	const unblockActions = [
		{ variation: 'section', label: __('Section', domain), wrap: true },
		{ variation: 'container', label: __('Container', domain), wrap: true },
		{ variation: 'div', label: __('Div', domain), wrap: true },
		{ variation: 'anchor', label: __('Link', domain), wrap: true },
		{ variation: 'heading', label: __('Heading', domain) },
		{ variation: 'paragraph', label: __('Paragraph', domain) },
		{ variation: 'image', label: __('Image', domain) },
		{ blockName: conditionBlock, label: __('Condition', domain), wrap: true },
		{ blockName: loopBlock, label: __('Loop', domain), wrap: true },
	];

	function canReplaceBlock(editor, clientId) {
		return editor.getBlockMode(clientId) !== 'html' &&
			editor.isBlockValid(clientId) &&
			editor.canEditBlock(clientId) &&
			editor.canRemoveBlock(clientId);
	}

	function getMenuSelection(editor, clientIds) {
		const first = clientIds[0];
		const root = editor.getBlockRootClientId(first);
		if (root === null || !clientIds.every((id) => editor.getBlockEditingMode(id) === 'default')) {
			return null;
		}

		const siblings = editor.getBlockOrder(root);
		const ids = siblings.filter((id) => clientIds.includes(id));
		const start = siblings.indexOf(ids[0]);
		if (ids.length !== clientIds.length || siblings[start + ids.length - 1] !== ids.at(-1)) {
			return null;
		}

		return { ids, root, start };
	}

	function getInsertRoot(editor, clientId) {
		if (!clientId || !editor.canEditBlock(clientId) || !editor.isBlockValid(clientId) ||
			editor.getBlockMode(clientId) === 'html') {
			return null;
		}
		if (editor.getBlockName(clientId) === elementBlock) {
			const { tagName, content } = editor.getBlockAttributes(clientId);
			// Unblock stores text inline. These tags also cannot hold the block choices in this menu.
			if (content !== undefined || /^(area|audio|base|br|col|colgroup|datalist|dl|embed|h[1-6]|head|hr|iframe|img|input|link|meta|ol|optgroup|option|p|param|picture|script|select|source|style|svg|table|tbody|textarea|tfoot|thead|tr|track|ul|video|wbr)$/i.test(tagName)) {
				return null;
			}
		}
		return clientId;
	}

	function isLinkBlock(editor, id) {
		return editor.getBlockName(id) === elementBlock && editor.getBlockAttributes(id)?.tagName?.toLowerCase() === 'a';
	}

	function makeUnblockBlock(action, children, groupAttributes) {
		if (!action.variation) {
			return createBlock(action.blockName, {}, children);
		}

		const attributes = { ...action.variation.attributes };
		const defaults = createBlocksFromInnerBlocksTemplate(action.variation.innerBlocks);
		if (children) {
			// Unblock's Section variation includes the Container that receives the content.
			if (action.variation.name === 'section' && defaults[0]) {
				defaults[0].innerBlocks = children;
			}
			if (action.variation.name === 'anchor') {
				delete attributes.content;
			}
		}

		if (groupAttributes) {
			const { anchor, className, lock, metadata } = groupAttributes;
			attributes.attrs = { ...attributes.attrs };
			if (anchor) {
				attributes.attrs.id = anchor;
			}
			if (className) {
				const classes = classNames([attributes.attrs.class, className].filter(Boolean).join(' '));
				attributes.attrs.class = [...new Set(classes)].join(' ');
			}
			Object.assign(attributes, { lock, metadata });
		}

		return createBlock(elementBlock, attributes, defaults.length ? defaults : children);
	}

	const interactiveContent = 'a, button, input, select, textarea, summary, iframe, audio[controls], video[controls], [tabindex], [contenteditable]';

	function canWrapInLink(blocks) {
		const template = document.createElement('template');
		template.innerHTML = serialize(blocks);
		if (template.content.querySelector(interactiveContent)) {
			return false;
		}

		function isNonInteractive(block) {
			const { tagName, attrs, content } = block.attributes;
			if (block.name === elementBlock && tagName) {
				// Check the saved tag and interactive attributes without creating that element.
				const hasInteractiveTag = /^(a|button|input|select|textarea|summary|iframe)$/i.test(tagName) ||
					(/^(audio|video)$/i.test(tagName) && Object.hasOwn(attrs ?? {}, 'controls'));
				if (hasInteractiveTag || ['tabindex', 'contenteditable'].some((name) => Object.hasOwn(attrs ?? {}, name))) {
					return false;
				}
			}
			if (block.name.startsWith('unblock/') && typeof content === 'string') {
				template.innerHTML = content;
				if (template.content.querySelector(interactiveContent)) {
					return false;
				}
			}
			return block.innerBlocks.every(isNonInteractive);
		}

		return blocks.every(isNonInteractive);
	}

	function UnblockSubmenu({ kind, label, actions, active, setActive, run }) {
		const id = useId();
		const rtl = isRTL();
		const isOpen = active?.kind === kind;
		const openKey = rtl ? 'ArrowLeft' : 'ArrowRight';
		const closeKey = rtl ? 'ArrowRight' : 'ArrowLeft';
		const focusFirstItem = useCallback((menu) => {
			if (menu) {
				requestAnimationFrame(() => {
					if (menu.isConnected) {
						menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
					}
				});
			}
		}, []);

		function close(returnFocus) {
			if (returnFocus) {
				active.anchor.focus();
			}
			setActive(null);
		}

		return h(Fragment, null,
			h(MenuItem, {
				'aria-haspopup': 'menu',
				'aria-expanded': isOpen,
				'aria-controls': isOpen ? id : undefined,
				suffix: h('span', { 'aria-hidden': true }, rtl ? '‹' : '›'),
				onClick: (event) => setActive(isOpen ? null : { kind, anchor: event.currentTarget }),
				onKeyDownCapture: (event) => {
					if (event.key === openKey || (isOpen && (event.key === 'Escape' || event.key === closeKey))) {
						event.preventDefault();
						event.stopPropagation();
						setActive(event.key === openKey ? { kind, anchor: event.currentTarget } : null);
					}
				},
			}, label),
			isOpen && h(Popover, {
				anchor: active.anchor,
				placement: rtl ? 'left-start' : 'right-start',
				className: 'components-dropdown__content',
				shift: true,
				animate: false,
				focusOnMount: false,
				onClose: () => close(true),
				onFocusOutside: (event) => {
					const next = event.relatedTarget;
					if (next && next !== active.anchor && !active.anchor.ownerDocument.getElementById(id)?.contains(next)) {
						close(false);
					}
				},
				onKeyDown: (event) => {
					if (event.key === 'Escape') {
						event.preventDefault();
						event.stopPropagation();
						close(true);
					}
				},
			}, h(NavigableMenu, { id, ref: focusFirstItem, 'aria-label': label, className: 'components-dropdown-menu__menu no-icons',
				onKeyDown: (event) => {
					// NavigableMenu handles arrows on its DOM node before React receives them.
					if (event.key === closeKey) {
						close(true);
					}
				},
			}, actions.map((action) => h(MenuItem, {
				key: action.variation?.name ?? action.blockName,
				icon: action.icon && h(BlockIcon, { icon: action.icon }),
				iconPosition: 'left',
				onClick: () => run(kind, action),
			}, action.label)))),
		);
	}

	function PositionedUnblockGroup({ children }) {
		const marker = useRef(null);
		const [host, setHost] = useState(null);
		useLayoutEffect(() => {
			const anchor = marker.current;
			const group = anchor.parentElement;
			const mount = anchor.ownerDocument.createElement('div');
			mount.className = 'uplink-unblock-menu-position';

			function placeMenu() {
				const items = [...group.children].filter((node) => node.getAttribute('role') === 'menuitem');
				const pattern = items.find((node) => node.getAttribute('aria-haspopup') === 'dialog' &&
					node.textContent.trim() === __('Create pattern'));
				const groupAction = items.find((node) => node.textContent.trim() === __('Group'));
				const before = pattern ? pattern.nextSibling : groupAction ?? anchor;
				mount.classList.toggle('is-before-group', !pattern && !!groupAction);
				if (before !== mount && (mount.parentNode !== group || mount.nextSibling !== before)) {
					group.insertBefore(mount, before);
				}
			}

			// Core's pattern action is a separate fill and may mount after this one.
			placeMenu();
			setHost(mount);
			const observer = new MutationObserver(placeMenu);
			observer.observe(group, { childList: true });
			return () => {
				observer.disconnect();
				mount.remove();
			};
		}, []);

		return h(Fragment, null, h('span', { hidden: true, ref: marker }), host && createPortal(children, host));
	}

	function UnblockMenuItems({ clientIds, onClose }) {
		const registry = useRegistry();
		const [active, setActive] = useState(null);
		const { variations, childTypes, siblingTypes, canWrap, canConvert, insideLink, childInsideLink, siblings, start } =
			useSelect((selectStore) => {
				const editor = selectStore(blockEditor);
				const selection = getMenuSelection(editor, clientIds);
				if (!selection) {
					return {};
				}
				const { ids, root, start } = selection;
				const single = ids.length === 1 ? ids[0] : null;
				const insertRoot = getInsertRoot(editor, single);
				const insideLink = editor.getBlockParents(ids[0]).some((id) => isLinkBlock(editor, id));
				return {
					variations: selectStore(blocksStore).getBlockVariations(elementBlock),
					childTypes: insertRoot && insertableBlockTypes.filter((name) => editor.canInsertBlockType(name, insertRoot)),
					siblingTypes: insertableBlockTypes.filter((name) => editor.canInsertBlockType(name, root)),
					canWrap: ids.every((id) => canReplaceBlock(editor, id) && editor.canMoveBlock(id) &&
						!getBlockType(editor.getBlockName(id))?.parent?.length),
					canConvert: single && editor.getBlockName(single) === 'core/group' &&
						canReplaceBlock(editor, single) && !editor.getBlockAttributes(single)?.templateLock,
					insideLink,
					childInsideLink: insideLink || (single && isLinkBlock(editor, single)),
					siblings: editor.getBlocks(root),
					start,
				};
			}, [clientIds]);

		const allowLink = useMemo(() => canWrap && !insideLink && canWrapInLink(siblings.slice(start, start + clientIds.length)),
			[canWrap, insideLink, siblings, start, clientIds.length]);
		const actions = unblockActions.flatMap((action) => {
			if (action.blockName) {
				const type = getBlockType(action.blockName);
				return type ? [{ ...action, icon: type.icon }] : [];
			}
			const variation = variations?.find(({ name }) => name === action.variation);
			return variation ? [{ ...action, blockName: elementBlock, variation, icon: variation.icon }] : [];
		});
		const inserts = actions.filter((action) => childTypes?.includes(action.blockName) &&
			(action.variation?.name !== 'anchor' || !childInsideLink));
		const wrappers = canWrap ? actions.filter((action) => action.wrap && siblingTypes?.includes(action.blockName) &&
			(action.variation?.name !== 'anchor' || allowLink)) : [];
		const section = canConvert && siblingTypes?.includes(elementBlock) &&
			actions.find((action) => action.variation?.name === 'section');

		function run(kind, action) {
			const editor = registry.select(blockEditor);
			const selection = getMenuSelection(editor, clientIds);
			if (!selection) {
				return;
			}
			const { ids } = selection;
			const editorActions = registry.dispatch(blockEditor);
			if (kind === 'insert') {
				const insertRoot = getInsertRoot(editor, ids.length === 1 ? ids[0] : null);
				if (insertRoot && editor.canInsertBlockType(action.blockName, insertRoot)) {
					onClose();
					editorActions.insertBlocks([makeUnblockBlock(action)], editor.getBlockCount(insertRoot), insertRoot);
				}
				return;
			}
			const blocks = editor.getBlocksByClientId(ids);
			const group = kind === 'convert' ? blocks[0] : null;
			// A replaced client ID cannot also appear inside its replacement.
			const children = group ? group.innerBlocks : blocks.map((block) => cloneBlock(block, {}, block.innerBlocks));
			const replacement = makeUnblockBlock(action, children, group?.attributes);
			onClose();
			editorActions.replaceBlocks(ids, [replacement], 0);
		}

		const label = h('span', { className: 'uplink-unblock-menu-label' },
			catalog.unblockIcon && h('img', { src: catalog.unblockIcon, alt: '', width: 16, height: 16 }),
			__('Unblock', domain),
		);
		return section || inserts.length || wrappers.length ? h(PositionedUnblockGroup, null, h(MenuGroup, { label },
			section && h(MenuItem, {
				icon: h(BlockIcon, { icon: section.icon }),
				iconPosition: 'left',
				onClick: () => run('convert', section),
			}, __('Convert to Section', domain)),
			inserts.length > 0 && h(UnblockSubmenu, {
				kind: 'insert', label: __('Insert', domain), actions: inserts, active, setActive, run,
			}),
			wrappers.length > 0 && h(UnblockSubmenu, {
				kind: 'wrap', label: __('Wrap in', domain), actions: wrappers, active, setActive, run,
			}),
		)) : null;
	}

	function UnblockMenu() {
		return h(BlockSettingsMenuControls, null, ({ selectedClientIds, onClose }) =>
			selectedClientIds?.length ? h(UnblockMenuItems, { clientIds: selectedClientIds, onClose }) : null
		);
	}

	function hasClass(target, item) {
		const classes = classNames(target.classValue);
		return classes.includes(item.name) ||
			!!(target.attrs && item.unblockId && classes.includes(item.unblockId));
	}

	function RecipeForm({ mode, onSaved, onCancel }) {
		const [name, setName] = useState('');
		const [text, setText] = useState('');
		const [error, setError] = useState('');
		const [busy, setBusy] = useState(false);
		const importing = mode === 'import';

		async function readFile(event) {
			const file = event.target.files[0];
			if (!file) {
				return;
			}
			setError('');
			if (file.size > 1100000) {
				setError(__('The recipe import is too large.', domain));
				return;
			}
			try {
				setText(await file.text());
			} catch {
				setError(__('The selected file could not be read.', domain));
			}
		}

		async function submit(event) {
			event.preventDefault();
			if (busy) {
				return;
			}
			setError('');
			let data = { recipes: [{ name, code: text }] };
			if (importing) {
				try {
					data = JSON.parse(text);
				} catch {
					setError(__('Enter valid recipe JSON or choose a JSON file.', domain));
					return;
				}
				if (!data || typeof data !== 'object') {
					setError(__('The JSON must contain a recipe list.', domain));
					return;
				}
			}

			setBusy(true);
			try {
				onSaved(await wp.apiFetch({ path: catalog.recipeRoute, method: 'POST', data }));
			} catch (failure) {
				setError(failure?.message || __('WordPress could not save the recipes.', domain));
			} finally {
				setBusy(false);
			}
		}

		return h('form', { className: 'uplink-acss-recipe-form', onSubmit: submit, 'aria-busy': busy },
			importing
				? h('label', { className: 'uplink-acss-file' },
					__('Choose a JSON file', domain),
					h('input', { type: 'file', accept: '.json,application/json', onChange: readFile, disabled: busy }),
				)
				: h(TextControl, {
					label: __('Recipe name', domain),
					help: __('For example, card-stack expands when you type ?card-stack;', domain),
					value: name,
					onChange: setName,
					disabled: busy,
				}),
			h(TextareaControl, {
				label: importing ? __('Recipe JSON', domain) : __('Recipe CSS', domain),
				help: importing
					? __('Use a list of recipes with name and code fields, or an ACSS expansions object.', domain)
					: __('Use %root% to reference the current selector.', domain),
				value: text,
				onChange: setText,
				rows: 7,
				disabled: busy,
			}),
			error && h('p', { role: 'alert', className: 'uplink-acss-help' }, error),
			h('div', { className: 'uplink-acss-actions' },
				h(Button, { variant: 'tertiary', onClick: onCancel, disabled: busy }, __('Cancel', domain)),
				h(Button, {
					type: 'submit',
					variant: 'primary',
					isBusy: busy,
					disabled: busy || !text.trim() || (!importing && !name.trim()),
				}, importing ? __('Import recipes', domain) : __('Save recipe', domain)),
			),
		);
	}

	function Sidebar() {
		const [group, setGroup] = useState('variables');
		const [source, setSource] = useState('all');
		const [query, setQuery] = useState('');
		const [limit, setLimit] = useState(pageSize);
		const [message, setMessage] = useState('');
		const [manualCopy, setManualCopy] = useState('');
		const [recipeForm, setRecipeForm] = useState('');
		const [customRecipes, setCustomRecipes] = useState(catalog.customRecipes);
		const selected = useSelect((store) => classTarget(store(blockEditor)), []);
		const entries = useSelect((store) => getEntries(group, store('core')), [group, customRecipes]);
		const sources = group === 'recipes'
			? [{ value: 'custom', label: sourceNames.custom }]
			: [{ value: 'unblock', label: sourceNames.unblock }];
		if (catalog.acssAvailable) {
			sources.unshift(
				{ value: 'all', label: __('All sources', domain) },
				{ value: 'acss', label: sourceNames.acss },
			);
		}
		const search = (group === 'classes' ? query.trim().replace(/^\./, '') : query.trim()).toLowerCase();
		const items = entries.filter((item) =>
			(source === 'all' || item.source === source || item.source === 'both') &&
			(item.name.toLowerCase().includes(search) || item.code.toLowerCase().includes(search))
		);

		function recipeSaved(result) {
			catalog.customRecipes = result.recipes;
			setCustomRecipes(result.recipes);
			setGroup('recipes');
			setRecipeForm('');
			setSource('custom');
			setQuery('');
			setLimit(pageSize);
			setMessage(result.added === 1
				? __('Recipe saved.', domain)
				: sprintf(__('%d recipes saved.', domain), result.added));
		}

		async function copy(item) {
			try {
				await navigator.clipboard.writeText(item.code);
				setManualCopy('');
				setMessage(sprintf(__('Copied %s.', domain), item.name));
			} catch {
				setManualCopy(item.code);
				setMessage(__('Clipboard access was unavailable. Copy the text below.', domain));
			}
		}

		function toggleClass(item) {
			const target = classTarget(select(blockEditor));
			if (!target || target.id !== selected?.id) {
				setMessage(__('Select an editable block and try again.', domain));
				return;
			}

			const { name, unblockId } = item;
			const previous = classNames(target.classValue);
			const removing = hasClass(target, item);
			const next = removing
				? previous.filter((value) => value !== name && (!target.attrs || value !== unblockId))
				: [...previous, target.attrs && unblockId ? unblockId : name];
			const value = next.join(' ');
			const changes = target.attrs
				? { attrs: { ...target.attrs, class: value } }
				: { className: value || undefined };

			if (target.attrs && !value) {
				delete changes.attrs.class;
			}
			if (target.attrs && unblockId) {
				changes.styles = removing
					? target.styles.filter((id) => id !== unblockId)
					: [...new Set([...target.styles, unblockId])];
			}

			dispatch(blockEditor).updateBlockAttributes(target.id, changes);
			setMessage(removing
				? sprintf(__('Removed %s.', domain), name)
				: sprintf(__('Applied %s.', domain), name));
		}

		return h(
			PluginSidebar,
			{ name: 'catalog', title, icon: 'editor-code' },
			h('div', { className: 'uplink-acss-catalog' },
				h('div', { className: 'uplink-acss-toolbar' },
					h('div', { className: 'uplink-acss-segments', role: 'group', 'aria-label': __('Catalog', domain) },
						Object.entries(groups).map(([value, label]) => h(Button, {
							key: value,
							'aria-pressed': group === value,
							onClick: () => {
								setGroup(value);
								setSource('all');
								setQuery('');
								setLimit(pageSize);
								setMessage('');
								setManualCopy('');
								setRecipeForm('');
							},
						}, label)),
					),
					h(SearchControl, {
						label: __('Search the catalog', domain),
						placeholder: sprintf(__('Search %s', domain), groups[group].toLowerCase()),
						value: query,
						onChange: (value) => {
							setQuery(value);
							setLimit(pageSize);
						},
					}),
					catalog.acssAvailable && h(SelectControl, {
						label: __('Source', domain),
						value: source,
						options: sources,
						onChange: (value) => {
							setSource(value);
							setLimit(pageSize);
						},
					}),
					group === 'recipes' && catalog.recipeRoute && h('div', { className: 'uplink-acss-recipe-actions' },
						h(Button, {
							variant: 'secondary',
							'aria-expanded': recipeForm === 'add',
							onClick: () => setRecipeForm(recipeForm === 'add' ? '' : 'add'),
						}, __('Add recipe', domain)),
						h(Button, {
							variant: 'secondary',
							'aria-expanded': recipeForm === 'import',
							onClick: () => setRecipeForm(recipeForm === 'import' ? '' : 'import'),
						}, __('Import JSON', domain)),
					),
				),
				h('div', { className: 'uplink-acss-results-pane' },
					group === 'recipes' && recipeForm && h(RecipeForm, {
						key: recipeForm,
						mode: recipeForm,
						onSaved: recipeSaved,
						onCancel: () => setRecipeForm(''),
					}),
					group === 'classes' && !selected && h('p', { className: 'uplink-acss-help' },
						__('Select an editable block to apply classes, or copy a class to the HTML Inspector.', domain)),
					group === 'recipes' && h('p', { className: 'uplink-acss-help' },
						__('Type ? in a CSS rule to expand a recipe, or copy it from this list.', domain)),
					h('div', { className: 'uplink-acss-status', role: 'status' }, message),
					manualCopy && h(TextareaControl, {
						label: __('Text to copy', domain),
						value: manualCopy,
						readOnly: true,
						rows: 4,
						onFocus: (event) => event.target.select(),
					}),
					items.length > 0
						? h('ul', { className: 'uplink-acss-results', 'aria-label': groups[group] },
							items.slice(0, limit).map((item) => {
								const active = group === 'classes' && selected && hasClass(selected, item);
								const canApply = group === 'classes' && selected &&
									(active || selected.attrs || item.source !== 'unblock' || item.global);
								return h('li', { key: item.name },
									h('div', { className: 'uplink-acss-result-title' },
										h('code', null, group === 'variables' ? item.code : item.name),
										h('span', { className: 'uplink-acss-source' }, item.detail),
									),
									h('div', { className: 'uplink-acss-actions' },
										h(Button, {
											variant: canApply ? 'tertiary' : 'secondary',
											size: 'compact',
											'aria-label': sprintf(__('Copy %s', domain), item.name),
											onClick: () => copy(item),
										}, __('Copy', domain)),
										canApply && h(Button, {
											variant: 'secondary',
											size: 'compact',
											'aria-label': active
												? sprintf(__('Remove %s from the selected block', domain), item.name)
												: sprintf(__('Apply %s to the selected block', domain), item.name),
											onClick: () => toggleClass(item),
										}, active ? __('Remove', domain) : __('Apply', domain)),
									),
								);
							}),
						)
						: h('p', { className: 'uplink-acss-empty' }, search
							? __('No matches. Try a different search.', domain)
							: __('No entries are available for this source.', domain)),
					items.length > limit && h(Button, {
						className: 'uplink-acss-more',
						variant: 'secondary',
						onClick: () => setLimit(limit + pageSize),
					}, __('Show more', domain)),
				),
			),
		);
	}

	wp.plugins.registerPlugin('fw-unblock-extender', { render: Sidebar, icon: 'editor-code' });
	wp.plugins.registerPlugin('fw-unblock-extender-block-actions', { render: UnblockMenu });
})(window.wp, window.fwUnblockExtender);
