(function (wp) {
	'use strict';

	const { createBlock, getBlockType, getSaveContent } = wp.blocks;
	const elementBlock = 'unblock/element';
	const slotTag = 'fw-unblock-conversion-slot';
	const hybridChecks = {
		'core/heading': () => true,
		'core/list': () => true,
		'core/button': (attrs) => !attrs.style?.background && !attrs.style?.dimensions?.width,
		'core/image': (attrs, settings) => attrs.url &&
			((attrs.linkDestination && attrs.linkDestination !== 'none') ||
				!(attrs.lightbox?.enabled ?? settings.imageLightbox)),
		'core/video': (attrs) => attrs.src && !attrs.autoplay,
	};

	function canConvert(block, editor, settings) {
		const type = block && getBlockType(block.name);
		if (!type?.save || block.name.startsWith('unblock/') || !editor.isBlockValid(block.clientId) ||
			!editor.canEditBlock(block.clientId) || !editor.canRemoveBlock(block.clientId) ||
			editor.getBlockMode(block.clientId) === 'html' || editor.getBlockEditingMode(block.clientId) !== 'default' ||
			editor.areInnerBlocksControlled(block.clientId)) {
			return false;
		}
		const { metadata, templateLock } = block.attributes;
		if (templateLock || (metadata && Object.keys(metadata).some((key) => key !== 'name'))) {
			return false;
		}
		const check = hybridChecks[block.name];
		return check ? Boolean(check(block.attributes, settings)) : !settings.excluded.includes(block.name);
	}

	function readMarkup(block) {
		// A temporary Classic block serializes raw markup, so each slot survives InnerBlocks.Content.
		const slots = block.innerBlocks.map((child, index) => createBlock('core/freeform', {
			content: '<' + slotTag + ' data-slot="' + index + '"></' + slotTag + '>',
		}));
		const html = getSaveContent(block.name, block.attributes, slots).replace(
			/<!-- wp:freeform -->\s*(<fw-unblock-conversion-slot data-slot="\d+"><\/fw-unblock-conversion-slot>)\s*<!-- \/wp:freeform -->/g,
			'$1',
		);
		if (!html || /\{[{%#]|<!--|\bbid\s*=/i.test(html)) {
			return null;
		}
		const template = document.createElement('template');
		template.innerHTML = html;
		if (template.content.querySelector('script, style, iframe, object, embed, form, template, noscript')) {
			return null;
		}
		for (const node of template.content.querySelectorAll('*')) {
			if ([...node.attributes].some(({ name, value }) => /^(?:on|data-wp-|data-unbk-)/i.test(name) ||
				/\{[{%#]/.test(value))) {
				return null;
			}
		}
		return /\{[{%#]/.test(template.content.textContent) ? null : html;
	}

	function replaceSlots(blocks, children, seen) {
		return blocks.flatMap((block) => {
			if (block.attributes.tagName === slotTag) {
				const value = block.attributes.attrs?.['data-slot'];
				const index = Number(value);
				if (String(index) !== value || !children[index] || seen.has(index)) {
					throw new Error('Invalid conversion slot');
				}
				seen.add(index);
				return children[index];
			}
			block.innerBlocks = replaceSlots(block.innerBlocks, children, seen);
			return [block];
		});
	}

	function applyLayout(block, root) {
		const layout = { ...getBlockType(block.name).supports?.layout?.default, ...block.attributes.layout };
		const attrs = { ...root.attributes.attrs };
		const style = document.createElement('div').style;
		style.cssText = attrs.style || '';
		if (layout.type === 'flex') {
			style.display = 'flex';
			if (layout.orientation === 'vertical') style.flexDirection = 'column';
			style.flexWrap = layout.flexWrap === 'nowrap' ? 'nowrap' : 'wrap';
			style.justifyContent = { left: 'flex-start', right: 'flex-end', center: 'center', 'space-between': 'space-between' }[layout.justifyContent] || '';
			style.alignItems = { top: 'flex-start', center: 'center', bottom: 'flex-end', stretch: 'stretch' }[layout.verticalAlignment] || '';
		} else if (layout.type === 'grid') {
			style.display = 'grid';
			const count = Number(layout.columnCount);
			if (Number.isInteger(count) && count > 0) {
				style.gridTemplateColumns = 'repeat(' + count + ', minmax(0, 1fr))';
			} else {
				style.gridTemplateColumns = 'repeat(auto-fill, minmax(min(100%, ' + (layout.minimumColumnWidth || '12rem') + '), 1fr))';
			}
		} else {
			return;
		}
		const gap = block.attributes.style?.spacing?.blockGap;
		const gapValue = (value) => typeof value === 'string' ? value.replace(/^var:preset\|spacing\|([\w-]+)$/, 'var(--wp--preset--spacing--$1)') : '';
		style.gap = typeof gap === 'object' && gap ? [gapValue(gap.top) || 'normal', gapValue(gap.left) || 'normal'].join(' ') : gapValue(gap) || '0.5em';
		// Let WordPress's Columns stylesheet retain its responsive stacking.
		if (block.name === 'core/columns') style.flexWrap = '';
		attrs.style = style.cssText;
		root.attributes.attrs = attrs;
	}

	function convert(block, editor, settings) {
		if (!canConvert(block, editor, settings)) return null;

		try {
			const html = readMarkup(block);
			if (!html) return null;
			const roots = window.Unblock.blocks.htmlToBlockInstances(html);
			if (roots.length !== 1 || roots[0].name !== elementBlock || roots[0].attributes.tagName === slotTag) {
				return null;
			}

			const children = block.innerBlocks.map((child) => convert(child, editor, settings) || [child]);
			if (children.some(([child], index) => child === block.innerBlocks[index] &&
				getBlockType(child.name)?.parent?.includes(block.name))) {
				return null;
			}
			const seen = new Set();
			const [root] = replaceSlots(roots, children, seen);
			if (seen.size !== children.length) return null;

			applyLayout(block, root);
			if (block.name === 'core/image' && Number.isInteger(block.attributes.id) && block.attributes.id > 0) {
				const image = root.innerBlocks.find((child) => child.attributes.tagName === 'img') ||
					root.innerBlocks.find((child) => child.attributes.tagName === 'a')?.innerBlocks
						.find((child) => child.attributes.tagName === 'img');
				if (image) {
					image.attributes.attachment = {
						id: block.attributes.id,
						type: 'image',
						size: block.attributes.sizeSlug || 'full',
					};
				}
			}
			const { metadata, lock } = block.attributes;
			return [createBlock(elementBlock, {
				...root.attributes,
				...(metadata?.name ? { metadata } : {}),
				...(lock ? { lock } : {}),
			}, root.innerBlocks)];
		} catch {
			return null;
		}
	}

	window.fwUnblockBlockConversion = { canConvert, convert };
})(window.wp);
