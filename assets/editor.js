(function (wp, catalog) {
	'use strict';

	const { Button, SearchControl, SelectControl, TextareaControl, TextControl } = wp.components;
	const { createElement: h, useState } = wp.element;
	const { __, sprintf } = wp.i18n;
	const { useSelect, select, dispatch } = wp.data;
	const { getBlockType, hasBlockSupport } = wp.blocks;
	const { PluginSidebar } = wp.editor;
	const blockEditor = wp.blockEditor.store;
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
})(window.wp, window.fwUnblockExtender);
