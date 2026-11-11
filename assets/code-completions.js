(function (wp, catalog, runtime) {
	'use strict';

	if (!runtime?.view?.EditorView || !runtime.state?.StateEffect || !runtime.language?.syntaxTree) {
		return;
	}

	const { EditorView } = runtime.view;
	const { EditorState, StateEffect, Transaction } = runtime.state;
	const { language, syntaxTree } = runtime.language;
	const { cssLanguage } = runtime.css;
	const { htmlLanguage } = runtime.html;
	const { __ } = wp.i18n;
	const domain = 'fw-unblock-extender';
	function recipeOptions() {
		return catalog.getEntries('recipes').map(({ name, detail }) => ({
			label: name,
			type: 'keyword',
			detail,
			apply: applyRecipe,
		}));
	}
	function classOptions(css) {
		return catalog.getEntries('classes').map(({ name, detail }) => ({
			label: name,
			type: 'class',
			detail,
			apply: css && window.CSS?.escape ? window.CSS.escape(name) : name,
		}));
	}

	function variableOptions(apply) {
		return catalog.getEntries('variables').map((entry) => ({
			label: entry.name,
			type: 'variable',
			detail: entry.detail,
			apply: apply(entry),
		}));
	}

	function ancestor(node, name) {
		while (node && node.name !== name) {
			node = node.parent;
		}
		return node;
	}

	function inStyleRule(node) {
		for (let current = node; current; current = current.parent) {
			if (current.name === 'Block' && current.parent?.name === 'RuleSet') {
				return true;
			}
		}
		return false;
	}

	function activeLanguage(state, pos) {
		if (cssLanguage.isActiveAt(state, pos, -1)) {
			return 'css';
		}
		return htmlLanguage.isActiveAt(state, pos, -1) ? 'html' : '';
	}

	function currentLine(state, pos) {
		const line = state.doc.lineAt(pos);
		return state.sliceDoc(line.from, pos);
	}

	function tokenEnd(state, pos) {
		const rest = state.sliceDoc(pos, state.doc.lineAt(pos).to);
		return pos + /^[\w\u0080-\uFFFF-]*/.exec(rest)[0].length;
	}

	function recipeTrigger(state, pos) {
		const match = /(?:^|[;{}])[\t ]*(\?[a-z0-9_-]*)$/i.exec(currentLine(state, pos));
		return match ? match[1] : null;
	}

	function insideCssLiteral(node) {
		for (let current = node; current; current = current.parent) {
			if (/Comment|StringLiteral|URLLiteral/.test(current.name)) {
				return true;
			}
		}
		return false;
	}

	function insertRecipe(view, trigger, from, to) {
		const code = catalog.getEntries('recipes').find(({ name }) => name === trigger.toLowerCase())?.code;
		if (!code) {
			return false;
		}

		const state = view.state;
		const indent = state.doc.lineAt(from).text.match(/^[\t ]*/)[0];
		const insert = code.trim().replaceAll('%root%', '&').replaceAll('\n', '\n' + indent);
		const end = state.sliceDoc(to, to + 1) === ';' ? to + 1 : to;
		view.dispatch({
			changes: { from, to: end, insert },
			selection: { anchor: from + insert.length },
			scrollIntoView: true,
			annotations: Transaction.userEvent.of('input.complete'),
		});
		return true;
	}

	function applyRecipe(view, completion, from, to) {
		insertRecipe(view, completion.label, from, to);
	}

	function completeVariable(state, pos, text, inDeclaration) {
		const inside = /\bvar\(\s*((?:--?[\w\u0080-\uFFFF-]*)?)$/i.exec(text);
		if (inside) {
			const end = tokenEnd(state, pos);
			const hasDelimiter = /^\s*[,)]/.test(state.sliceDoc(end, state.doc.lineAt(pos).to));
			return {
				from: pos - inside[1].length,
				to: end,
				options: variableOptions((entry) => entry.name + (hasDelimiter ? '' : ')')),
			};
		}

		const bare = /(?:^|[^\w\u0080-\uFFFF-])(--[\w\u0080-\uFFFF-]*)$/.exec(text);
		return bare && inDeclaration
			? { from: pos - bare[1].length, to: tokenEnd(state, pos), options: variableOptions((entry) => entry.code) }
			: null;
	}

	function completeCss(state, pos, node) {
		if (insideCssLiteral(node)) {
			return null;
		}

		const trigger = recipeTrigger(state, pos);
		if (trigger && inStyleRule(node)) {
			return { from: pos - trigger.length, to: tokenEnd(state, pos), options: recipeOptions(), validFor: /^\?[\w-]*$/ };
		}

		const text = currentLine(state, pos);
		const statement = text.split(/[;{}]/).pop();
		const declaration = !!ancestor(node, 'Declaration') || /^\s*[\w-]+\s*:/.test(statement);
		const variable = completeVariable(state, pos, text, declaration);
		if (variable) {
			return variable;
		}

		const selector = /(?:^|[^\\\w\u0080-\uFFFF-])\.([\w\u0080-\uFFFF-]*)$/.exec(text);
		if (selector && (!declaration || ancestor(node, 'ClassSelector'))) {
			return {
				from: pos - selector[1].length,
				to: tokenEnd(state, pos),
				options: classOptions(true),
				validFor: /^[\w\u0080-\uFFFF-]*$/,
			};
		}
		return null;
	}

	function completeHtml(state, pos, node) {
		const attribute = ancestor(node, 'Attribute');
		const nameNode = attribute?.getChild('AttributeName');
		if (!nameNode) {
			return null;
		}

		const name = state.sliceDoc(nameNode.from, nameNode.to).toLowerCase();
		const value = /^\s*=\s*(["'])([\s\S]*)$/.exec(state.sliceDoc(nameNode.to, pos));
		if (!value || value[2].includes(value[1])) {
			return null;
		}

		const text = value[2];
		if (/\{[{%#][^}]*$/.test(text)) {
			return null;
		}

		if (name === 'class') {
			const token = /(?:^|\s)([^\s<>"'{}]*)$/.exec(text);
			const rest = state.sliceDoc(pos, state.doc.lineAt(pos).to);
			return token ? {
				from: pos - token[1].length,
				to: pos + /^[^\s<>"'{}]*/.exec(rest)[0].length,
				options: classOptions(false),
				validFor: /^[^\s<>"'{}]*$/,
			} : null;
		}

		if (name === 'style') {
			return completeVariable(state, pos, text, /^\s*[\w-]+\s*:/.test(text.split(';').pop()));
		}
		return null;
	}

	function complete(context) {
		const { state, pos } = context;
		if (state.readOnly) {
			return null;
		}

		const tree = syntaxTree(state);
		const node = tree.resolveInner(pos, -1);
		const mode = activeLanguage(state, pos);
		if (mode === 'css') {
			return completeCss(state, pos, node);
		}
		return mode === 'html' ? completeHtml(state, pos, node) : null;
	}

	function languageData() {
		return [{ autocomplete: complete }];
	}

	const expandOnSemicolon = EditorView.inputHandler.of((view, from, to, text) => {
		const { state } = view;
		if (text !== ';' || from !== to || state.readOnly || state.selection.ranges.length !== 1 ||
			activeLanguage(state, from) !== 'css') {
			return false;
		}

		const trigger = recipeTrigger(state, from);
		const node = syntaxTree(state).resolveInner(from, -1);
		return !!trigger && !insideCssLiteral(node) && inStyleRule(node) &&
			insertRecipe(view, trigger, from - trigger.length, to);
	});

	const extensions = [EditorState.languageData.of(languageData), expandOnSemicolon];

	// Unblock's Variables code view supplies an explicit CodeMirror source list.
	// Its CSS Inspector and HTML Inspector use CodeMirror's language data.
	const completionFacet = runtime.autocomplete?.autocompletion().find((extension) => {
		const defaults = extension.facet?.combine?.([]);
		return defaults && typeof defaults === 'object' && Object.hasOwn(defaults, 'override');
	})?.facet;

	function addCompletions(view) {
		if (view.state.facet(EditorState.languageData).includes(languageData)) {
			return;
		}

		const override = completionFacet && view.state.facet(completionFacet).override;
		if (Array.isArray(override) && Object.isExtensible(override) && !override.includes(complete)) {
			override.push(complete);
		}
		view.dispatch({ effects: StateEffect.appendConfig.of(extensions) });
	}

	function codeView(target) {
		const root = target.closest?.('.cm-content')?.closest('.cm-editor');
		const view = root && EditorView.findFromDOM(root);
		return view && !view.state.readOnly && view.contentDOM.isContentEditable ? view : null;
	}

	let savePending = false;

	async function saveWordPress() {
		const editor = wp.data.select('core/editor');
		const core = wp.data.select('core');
		if (!editor || editor.isPostSavingLocked() || editor.isSavingPost() ||
			editor.isSavingNonPostEntityChanges?.()) {
			return false;
		}

		const isSiteEditor = window.location.pathname.endsWith('/site-editor.php');
		if (isSiteEditor && editor.hasNonPostEntityChanges?.()) {
			wp.data.dispatch('core/edit-site').setIsSaveViewOpened(true);
			return true;
		}

		// In the post editor, Unblock's global CSS is a distinct WordPress entity.
		if (core.hasEditsForEntityRecord('unblock', 'css', 'css') &&
			!core.isSavingEntityRecord('unblock', 'css', 'css')) {
			try {
				await wp.data.dispatch('core').saveEditedEntityRecord('unblock', 'css', 'css', {
					throwOnError: true,
				});
			} catch (error) {
				wp.data.dispatch('core/notices').createErrorNotice(
					error?.message || __('Unblock CSS could not be saved.', domain),
				);
				return false;
			}
		}

		if (!editor.isSavingPost() && !editor.isPostSavingLocked() && editor.isEditedPostDirty()) {
			await wp.data.dispatch('core/editor').savePost();
		}
		return false;
	}

	document.addEventListener('focusin', (event) => {
		const view = codeView(event.target);
		if (view && view.state.facet(language)) {
			addCompletions(view);
		}
	}, true);

	document.addEventListener('keydown', (event) => {
		const view = codeView(event.target);
		if (!view) {
			return;
		}

		if (view.state.facet(language)) {
			addCompletions(view);
		}

		const saveKey = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
			!event.isComposing && event.key.toLowerCase() === 's';
		if (!saveKey) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		if (event.repeat || savePending) {
			return;
		}

		savePending = true;
		const input = view.contentDOM;
		// Give the editor time to commit its last transaction, then flush on blur.
		requestAnimationFrame(() => {
			input.blur();
			requestAnimationFrame(async () => {
				try {
					const reviewing = await saveWordPress();
					if (!reviewing && input.isConnected && document.activeElement === document.body) {
						input.focus({ preventScroll: true });
					}
				} catch (error) {
					wp.data.dispatch('core/notices').createErrorNotice(
						error?.message || __('WordPress could not save your changes.', domain),
					);
				} finally {
					savePending = false;
				}
			});
		});
	}, true);
})(window.wp, window.fwUnblockExtender, window.Unblock?.codeEditor);
