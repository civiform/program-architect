/**
 * CiviForm Flowchart Visualizer Module (`civiform-visualizer.js`)
 *
 * Standalone, plug-and-play module for rendering interactive CiviForm
 * ProgramMigrationWrapper flowcharts.
 *
 * Public API:
 *   window.CiviFormVisualizer.mount(containerEl)
 *   window.CiviFormVisualizer.render(programWrapper)
 *   window.CiviFormVisualizer.refreshLayout()
 */
(function (global) {
  "use strict";

  const VISUALIZER_TEMPLATE_HTML = '<div class="visualizer-embed-shell">\n        <!-- Program Hero Header -->\n        <header class="program-hero">\n          <div class="grid-container-widescreen">\n            <h2 class="program-hero__title" id="program-title-heading">Loading Program...</h2>\n            <p class="program-hero__subtitle" id="program-desc" style="margin-top: 0.25rem;"></p>\n            <div class="meta-pill-group" id="program-meta-pills"></div>\n          </div>\n        </header>\n\n        <!-- Flowchart Canvas Area -->\n        <div class="canvas-stage" id="canvas-stage">\n          <div class="grid-container-widescreen canvas-stage-inner">\n            <div class="canvas-sidebar">\n              <div class="canvas-toolbar">\n                <label for="locale-select" class="sim-label" style="margin-bottom: 0;">Language</label>\n                <select id="locale-select" class="usa-select margin-top-0" style="height: 2.2rem; padding: 0.2rem 0.6rem; font-size: 0.82rem; width: 100%;">\n                  <option value="en_US">en_US</option>\n                </select>\n              </div>\n\n              <div class="canvas-outline-container" id="canvas-outline-container">\n                <div class="canvas-outline__header" id="canvas-outline-toggle-btn" role="button" tabindex="0" aria-expanded="true">\n                  <span class="canvas-outline__title">Screens</span>\n                  <svg class="canvas-outline__arrow" id="canvas-outline-arrow" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">\n                    <path d="M7 10l5 5 5-5z" fill="currentColor"/>\n                  </svg>\n                </div>\n                <div class="canvas-outline__body" id="canvas-outline-body">\n                  <ul class="outline-list" id="canvas-outline-list"></ul>\n                </div>\n              </div>\n\n              <div class="canvas-toolbar">\n                <div class="legend-list" id="canvas-legend-list" aria-label="Flowchart Legend">\n                  <span class="legend-item"><span class="legend-swatch legend-swatch--program">P</span> Program screen</span>\n                  <span class="legend-item"><span class="legend-swatch legend-swatch--eligibility">E</span> Eligibility condition</span>\n                  <span class="legend-item"><span class="legend-swatch legend-swatch--visibility">V</span> Conditionally visible screen</span>\n                  <span class="legend-item"><span class="legend-swatch legend-swatch--loop">N</span> Enumerator screen</span>\n                </div>\n              </div>\n            </div>\n\n            <div class="flowchart-viewport" id="flowchart-viewport">\n              <svg class="flowchart-svg-layer" id="flowchart-svg" aria-hidden="true">\n                <defs>\n                  <marker id="arrow-default" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#005ea2"></path>\n                  </marker>\n                  <marker id="arrow-active" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#2e8540"></path>\n                  </marker>\n                  <marker id="arrow-stop" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#b50909"></path>\n                  </marker>\n                  <marker id="arrow-hidden" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#b0b5b9"></path>\n                  </marker>\n                  <marker id="arrow-loop" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#0081a1"></path>\n                  </marker>\n                  <marker id="arrow-conditional" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#9e6c00"></path>\n                  </marker>\n                  <marker id="dot-conditional" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4.5" markerHeight="4.5">\n                    <circle cx="5" cy="5" r="3.5" fill="#9e6c00"></circle>\n                  </marker>\n                </defs>\n              </svg>\n              <div class="flowchart-nodes-layer" id="flowchart-nodes"></div>\n            </div>\n          </div>\n        </div>\n      </div>';

  let mountContainer = null;
  let isMounted = false;

  function ensureMounted(targetEl) {
    const el = targetEl || mountContainer || document.getElementById("civiform-visualizer-mount");
    if (!el) return false;
    if (!isMounted || mountContainer !== el || !el.querySelector(".visualizer-embed-shell")) {
      el.innerHTML = VISUALIZER_TEMPLATE_HTML;
      mountContainer = el;
      isMounted = true;
      initVisualizerControls();
    }
    return true;
  }

    // =========================================================================
    // 1. FLOWCHART VISUALIZER ENGINE
    // =========================================================================
    let CIVIFORM_PROGRAM_DATA = {
      "program": {
        "id": 1,
        "adminName": "civiform-program",
        "displayMode": "PUBLIC",
        "eligibilityIsGating": true,
        "localizedName": { "translations": { "en_US": "CiviForm Application Program" } },
        "localizedShortDescription": { "translations": { "en_US": "Interactive flowchart visualization of CiviForm program structure." } },
        "blockDefinitions": []
      },
      "questions": []
    };
    /* END_CIVIFORM_PROGRAM_DATA */

    const state = {
      formData: CIVIFORM_PROGRAM_DATA,
      locale: 'en_US',
      availableLocales: ['en_US'],
      simulationEnabled: false,
      simValues: {}, // Keyed by questionId or enum_block_id
      predicateNotation: 'effective', // 'effective' | 'raw'
      zoom: 1.0
    };

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function getTranslation(localizedObj, locale = state.locale) {
      if (!localizedObj || !localizedObj.translations) return '';
      return (
        localizedObj.translations[locale] ||
        localizedObj.translations['en_US'] ||
        Object.values(localizedObj.translations)[0] ||
        ''
      ).trim();
    }

    function discoverLocales() {
      const locales = new Set();
      const scanObj = (obj) => {
        if (!obj) return;
        if (obj.translations) {
          Object.keys(obj.translations).forEach(l => {
            if (obj.translations[l] && typeof obj.translations[l] === 'string' && obj.translations[l].trim().length > 0) {
              locales.add(l);
            }
          });
        }
      };

      const prog = state.formData.program || {};
      scanObj(prog.localizedName);
      scanObj(prog.localizedShortDescription);
      scanObj(prog.localizedDescription);
      scanObj(prog.localizedConfirmationMessage);
      (prog.applicationSteps || []).forEach(st => {
        scanObj(st?.title);
        scanObj(st?.description);
      });

      state.availableLocales = Array.from(locales);
      if (state.availableLocales.length === 0) {
        state.availableLocales = ['en_US'];
      }
      if (!state.availableLocales.includes(state.locale)) {
        state.locale = state.availableLocales[0];
      }
      const select = document.getElementById('locale-select');
      if (select) {
        select.innerHTML = state.availableLocales.map(loc => {
          return `<option value="${loc}" ${loc === state.locale ? 'selected' : ''}>${loc}</option>`;
        }).join('');
      }
    }

    function getQuestionsMap() {
      const map = new Map();
      (state.formData.questions || []).forEach(q => {
        if (q.config && q.config.id != null) {
          map.set(q.config.id, q);
          map.set(String(q.config.id), q);
          map.set(Number(q.config.id), q);
          if (q.config.name) map.set(q.config.name, q);
        }
        if (q.id != null) {
          map.set(q.id, q);
          map.set(String(q.id), q);
          map.set(Number(q.id), q);
        }
        if (q.name) map.set(q.name, q);
      });
      return map;
    }

    function getQuestionTextPrompt(q, fallbackQId) {
      if (!q) {
        if (fallbackQId) return `Question #${fallbackQId}`;
        return 'Question';
      }
      return (
        getTranslation(q.config?.questionText) ||
        getTranslation(q.questionText) ||
        getTranslation(q.localizedQuestionText) ||
        q.config?.name ||
        q.name ||
        q.config?.description ||
        (fallbackQId ? `Question #${fallbackQId}` : 'Question')
      );
    }

    function isBlockEnumerator(block, questionsMap, allBlocks) {
      if (block.isEnumerator) return true;
      const hasEnumQuestion = (block.questionDefinitions || []).some(qd => {
        const q = questionsMap.get(qd.id);
        return q && q.type === 'enumerator';
      });
      if (hasEnumQuestion) return true;
      return allBlocks.some(other => other.repeaterId === block.id);
    }

    function getQuestionOptions(q) {
      return q?.questionOptions || q?.displayableOptions || q?.options || [];
    }

    // Traverse Predicate Tree recursively
    function collectLeafNodes(node, out = []) {
      if (!node) return out;
      if (node.questionId != null || node.type === 'leaf') {
        out.push(node);
        return out;
      }
      if (Array.isArray(node.children)) {
        node.children.forEach(child => collectLeafNodes(child.node || child, out));
      }
      return out;
    }

    function getAllVisibilityTriggerQuestionIds(blocks) {
      const qIds = new Set();
      (blocks || []).forEach(b => {
        const pred = b.hidePredicate || b.optionalPredicate;
        if (pred && pred.rootNode?.node) {
          const leaves = collectLeafNodes(pred.rootNode.node);
          leaves.forEach(leaf => {
            if (leaf.questionId != null) {
              qIds.add(String(leaf.questionId));
            }
          });
        }
      });
      return qIds;
    }

    function getQuestionPageRef(questionId) {
      if (!questionId) return '';
      const blocks = state.formData.program?.blockDefinitions || [];
      const qIdStr = String(questionId);

      for (let idx = 0; idx < blocks.length; idx++) {
        const b = blocks[idx];
        const qDefs = b.questionDefinitions || [];
        if (qDefs.some(qd => String(qd.id) === qIdStr)) {
          const pageNum = idx + 1;
          const pageTitle = getTranslation(b.localizedName) || b.name || `Screen ${pageNum}`;
          return `<span class="predicate-page-ref">(Screen ${pageNum}: ${escapeHtml(pageTitle)})</span>`;
        }
      }
      return '';
    }

    function formatLeafNode(node, questionsMap, invert = false, isStandalone = false, leadPrefix = '', includePageRef = true) {
      const q = questionsMap.get(node.questionId);
      const qPrompt = getQuestionTextPrompt(q, node.questionId);
      const pageRefHTML = includePageRef ? getQuestionPageRef(node.questionId) : '';
      const varQ = `<code class="predicate-variable">"${escapeHtml(qPrompt)}"</code>${pageRefHTML ? ' ' + pageRefHTML : ''}`;
      const rawValStr = String(node.value?.value || '');
      const prefix = leadPrefix || (isStandalone ? '' : 'When ');

      if (node.scalar === 'SELECTION' || node.scalar === 'SELECTIONS') {
        let parsedIds = [];
        try {
          parsedIds = JSON.parse(rawValStr).map(String);
        } catch (e) {
          parsedIds = [rawValStr];
        }
        const options = getQuestionOptions(q);
        const labels = options
          .filter(opt => parsedIds.includes(String(opt.id)) || parsedIds.includes(String(opt.adminName)))
          .map(opt => getTranslation(opt.localizedOptionText));

        const displayLabels = labels.length > 0 ? labels : parsedIds.map(id => `Option ${id}`);
        const rawIsNegative = (node.operator === 'NOT_IN' || node.operator === 'NONE_OF' || node.operator === 'NOT_EQUAL_TO');
        const effectiveIsNegative = invert ? !rawIsNegative : rawIsNegative;
        const opPhrase = effectiveIsNegative
          ? (displayLabels.length > 1 ? 'is none of:' : 'is not:')
          : (displayLabels.length > 1 ? 'is any of:' : 'is:');
        const bulletList = displayLabels.map(l => `<li>${escapeHtml(l)}</li>`).join('');
        return `<div><div style="margin-bottom:0.25rem; font-size:0.8rem; color:#1f2937;">${prefix}${varQ} ${opPhrase}</div><ul class="predicate-bullet-list">${bulletList}</ul></div>`;
      }

      if (node.scalar === 'CURRENCY_CENTS' || node.scalar === 'CURRENCY') {
        const valCents = Number(rawValStr || 0);
        const valDollars = '$' + (valCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const opMapNormal = { 'LESS_THAN': '<', 'LESS_THAN_OR_EQUAL_TO': '≤', 'GREATER_THAN': '>', 'GREATER_THAN_OR_EQUAL_TO': '≥', 'EQUAL_TO': '=', 'NOT_EQUAL_TO': '≠' };
        const opMapInverted = { 'LESS_THAN': '≥', 'LESS_THAN_OR_EQUAL_TO': '>', 'GREATER_THAN': '≤', 'GREATER_THAN_OR_EQUAL_TO': '<', 'EQUAL_TO': '≠', 'NOT_EQUAL_TO': '=' };
        const showOp = invert ? (opMapInverted[node.operator] || node.operator) : (opMapNormal[node.operator] || node.operator);
        return `<div style="font-size:0.8rem; color:#1f2937;">${prefix}${varQ} ${showOp} ${valDollars}</div>`;
      }

      if (node.scalar === 'DATE' && (node.operator === 'AGE_OLDER_THAN' || node.operator === 'AGE_YOUNGER_THAN')) {
        const N = Number(rawValStr || 0);
        const opMapNormal = { 'AGE_OLDER_THAN': '>', 'AGE_YOUNGER_THAN': '<' };
        const opMapInverted = { 'AGE_OLDER_THAN': '≤', 'AGE_YOUNGER_THAN': '≥' };
        const showOp = invert ? (opMapInverted[node.operator] || node.operator) : (opMapNormal[node.operator] || node.operator);
        return `<div style="font-size:0.8rem; color:#1f2937;">${prefix}${varQ} (Age) ${showOp} ${N} years</div>`;
      }

      const opNormal = { 'EQUAL_TO': '=', 'NOT_EQUAL_TO': '≠', 'GREATER_THAN': '>', 'LESS_THAN': '<' };
      const opInverted = { 'EQUAL_TO': '≠', 'NOT_EQUAL_TO': '=', 'GREATER_THAN': '≤', 'LESS_THAN': '≥' };
      const showOp = invert ? (opInverted[node.operator] || node.operator) : (opNormal[node.operator] || node.operator);
      const formattedVal = (rawValStr.startsWith('"') || rawValStr.startsWith('$') || !isNaN(Number(rawValStr))) ? rawValStr : `"${rawValStr}"`;
      return `<div style="font-size:0.8rem; color:#1f2937;">${prefix}${varQ} ${showOp} ${formattedVal}</div>`;
    }

    function formatPredicateNode(node, questionsMap, invert = false, isRoot = true, leadPrefix = '', includePageRef = true) {
      if (!node) return '';
      if (node.questionId != null || node.type === 'leaf') {
        return formatLeafNode(node, questionsMap, invert, isRoot, leadPrefix, includePageRef);
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        const isAnd = (node.type === 'and' ? !invert : invert);

        if (!isAnd) {
          // OR tree: multiple group cards
          const groupsHTML = node.children.map((c, idx) => {
            const childNode = c.node || c;
            const childFormatted = formatPredicateNode(childNode, questionsMap, invert, false, '', includePageRef);
            return `
              <div class="predicate-card-group">
                <div class="predicate-group-title">GROUP ${idx + 1} (MATCH ALL CONDITIONS)</div>
                ${childFormatted}
              </div>
            `;
          }).join('<div class="op-divider-or"><span class="op-badge-or">─── OR ───</span></div>');

          return groupsHTML;
        } else {
          // AND tree: conditions within a group
          const andJoiner = `
            <div class="op-divider-and">
              <div class="op-divider-line"></div>
              <span class="op-badge-and">AND</span>
              <div class="op-divider-line"></div>
            </div>
          `;
          const childrenFormatted = node.children.map(c => formatPredicateNode(c.node || c, questionsMap, invert, false, '', includePageRef)).join(andJoiner);
          if (isRoot) {
            return `
              <div class="predicate-card-group">
                ${childrenFormatted}
              </div>
            `;
          }
          return childrenFormatted;
        }
      }
      return '';
    }

    function formatEligibilityRequirement(node, questionsMap) {
      if (!node) return 'Must meet eligibility requirements to continue.';

      if (node.questionId != null || node.type === 'leaf') {
        const q = questionsMap.get(node.questionId);
        const rawValStr = String(node.value?.value || '');

        if (node.scalar === 'SELECTION' || node.scalar === 'SELECTIONS') {
          let parsedIds = [];
          try {
            parsedIds = JSON.parse(rawValStr).map(String);
          } catch (e) {
            parsedIds = [rawValStr];
          }
          const options = getQuestionOptions(q);
          const labels = options
            .filter(opt => parsedIds.includes(String(opt.id)) || parsedIds.includes(String(opt.adminName)))
            .map(opt => getTranslation(opt.localizedOptionText));

          const displayLabels = labels.length > 0 ? labels : parsedIds;
          const isNeg = (node.operator === 'NOT_IN' || node.operator === 'NONE_OF' || node.operator === 'NOT_EQUAL_TO');
          if (displayLabels.length === 1) {
            return isNeg
              ? `Must NOT select <strong>"${escapeHtml(displayLabels[0])}"</strong> to continue.`
              : `Must select <strong>"${escapeHtml(displayLabels[0])}"</strong> to continue.`;
          } else if (displayLabels.length > 1) {
            const joined = displayLabels.map(l => `<strong>"${escapeHtml(l)}"</strong>`).join(isNeg ? ' or ' : ' or ');
            return isNeg
              ? `Must NOT select ${joined} to continue.`
              : `Must select ${joined} to continue.`;
          }
          return `Must select valid option to continue.`;
        }

        if (node.scalar === 'CURRENCY_CENTS' || node.scalar === 'CURRENCY') {
          const valCents = Number(rawValStr || 0);
          const valDollars = '$' + (valCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const opTextMap = {
            'LESS_THAN': `be less than ${valDollars}`,
            'LESS_THAN_OR_EQUAL_TO': `be ≤ ${valDollars}`,
            'GREATER_THAN': `be greater than ${valDollars}`,
            'GREATER_THAN_OR_EQUAL_TO': `be ≥ ${valDollars}`,
            'EQUAL_TO': `equal ${valDollars}`,
            'NOT_EQUAL_TO': `not equal ${valDollars}`
          };
          const phrase = opTextMap[node.operator] || `${node.operator} ${valDollars}`;
          return `Must ${phrase} to continue.`;
        }

        if (node.scalar === 'DATE' && (node.operator === 'AGE_OLDER_THAN' || node.operator === 'AGE_YOUNGER_THAN')) {
          const N = Number(rawValStr || 0);
          if (node.operator === 'AGE_OLDER_THAN') {
            return `Must be older than ${N} years old to continue.`;
          } else if (node.operator === 'AGE_YOUNGER_THAN') {
            return `Must be younger than ${N} years old to continue.`;
          }
        }

        const opTextMap = {
          'LESS_THAN': `be < ${rawValStr}`,
          'LESS_THAN_OR_EQUAL_TO': `be ≤ ${rawValStr}`,
          'GREATER_THAN': `be > ${rawValStr}`,
          'GREATER_THAN_OR_EQUAL_TO': `be ≥ ${rawValStr}`,
          'EQUAL_TO': `be "${rawValStr}"`,
          'NOT_EQUAL_TO': `not be "${rawValStr}"`
        };
        const phrase = opTextMap[node.operator] || `${node.operator} "${rawValStr}"`;
        return `Must ${phrase} to continue.`;
      }

      if (Array.isArray(node.children) && node.children.length > 0) {
        const childTexts = node.children.map(c => formatEligibilityRequirement(c.node || c, questionsMap)).filter(Boolean);
        if (node.type === 'and') {
          return childTexts.join(' AND ');
        } else if (node.type === 'or') {
          return childTexts.join(' OR ');
        }
      }

      return 'Must meet eligibility criteria to continue.';
    }

    function describeEligibility(block, questionsMap) {
      const eligNode = block.eligibilityDefinition?.predicate?.rootNode?.node;
      if (!eligNode) return null;

      const action = block.eligibilityDefinition.predicate.action || 'ELIGIBLE_BLOCK';
      const leaf = collectLeafNodes(eligNode)[0];
      const q = questionsMap.get(leaf?.questionId);
      const qPrompt = getTranslation(q?.config?.questionText) || q?.config?.name || (leaf?.questionId ? `Question #${leaf.questionId}` : '');

      const passText = formatPredicateNode(eligNode, questionsMap, false, true, '', false);
      const stopText = formatPredicateNode(eligNode, questionsMap, true, true, '', false);

      let allowedOptionIds = null;
      if (leaf && (leaf.scalar === 'SELECTION' || leaf.scalar === 'SELECTIONS')) {
        try {
          allowedOptionIds = JSON.parse(String(leaf.value?.value || '[]')).map(String);
        } catch (e) {
          allowedOptionIds = [String(leaf.value?.value || '')];
        }
      }

      return {
        questionId: leaf?.questionId,
        questionPrompt: qPrompt,
        allowedOptionIds,
        effectivePassText: `Continue if ${passText}`,
        effectiveStopText: `Stopped if ${stopText}`,
        bannerRuleText: `Must satisfy ${passText} to continue`,
        rawText: `${action}: ${leaf?.scalar || ''} ${leaf?.operator || ''} ${leaf?.value?.value || ''}`
      };
    }

    function describePredicate(block, questionsMap) {
      const pred = block.hidePredicate || block.optionalPredicate;
      if (!pred || !pred.rootNode?.node) {
        return { hasCondition: false, effectiveText: 'Always Visible', rawText: 'hidePredicate: null' };
      }
      const action = pred.action || 'HIDE_BLOCK';
      const invert = (action === 'HIDE_BLOCK');
      const effectiveText = formatPredicateNode(pred.rootNode.node, questionsMap, invert, true);
      const rawLeaf = collectLeafNodes(pred.rootNode.node)[0];

      return {
        hasCondition: true,
        effectiveText: effectiveText,
        rawText: `${action} if ${rawLeaf?.scalar || ''} ${rawLeaf?.operator || ''} ${rawLeaf?.value?.value || ''}`
      };
    }

    function getBranchConditionLabel(bBlock, gateQ, questionsMap) {
      const pred = bBlock.hidePredicate || bBlock.optionalPredicate;
      if (!pred || !pred.rootNode?.node) return '<strong>All other cases</strong>';
      const action = pred.action || 'HIDE_BLOCK';
      const invert = (action === 'HIDE_BLOCK');
      const leaf = collectLeafNodes(pred.rootNode.node)[0];
      if (!leaf) return '<strong>Specific condition</strong>';

      const rawValStr = String(leaf.value?.value || '');

      if (leaf.scalar === 'SELECTION' || leaf.scalar === 'SELECTIONS') {
        let parsedIds = [];
        try {
          parsedIds = JSON.parse(rawValStr).map(String);
        } catch (e) {
          parsedIds = [rawValStr];
        }
        const options = getQuestionOptions(gateQ);
        const labels = options
          .filter(opt => parsedIds.includes(String(opt.id)) || parsedIds.includes(String(opt.adminName)))
          .map(opt => getTranslation(opt.localizedOptionText));
        const displayLabels = labels.length > 0 ? labels : parsedIds.map(id => `Option ${id}`);
        const bulletList = displayLabels.map(l => `<li>${escapeHtml(l)}</li>`).join('');
        return `<ul class="predicate-bullet-list" style="margin: 0; padding-left: 1rem;">${bulletList}</ul>`;
      }

      if (leaf.scalar === 'CURRENCY_CENTS') {
        const valCents = Number(rawValStr || 0);
        const valDollars = '$' + (valCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const opMapNormal = { 'LESS_THAN': '<', 'LESS_THAN_OR_EQUAL_TO': '≤', 'GREATER_THAN': '>', 'GREATER_THAN_OR_EQUAL_TO': '≥', 'EQUAL_TO': '=', 'NOT_EQUAL_TO': '≠' };
        const opMapInverted = { 'LESS_THAN': '≥', 'LESS_THAN_OR_EQUAL_TO': '>', 'GREATER_THAN': '≤', 'GREATER_THAN_OR_EQUAL_TO': '<', 'EQUAL_TO': '≠', 'NOT_EQUAL_TO': '=' };
        const showOp = invert ? (opMapInverted[leaf.operator] || leaf.operator) : (opMapNormal[leaf.operator] || leaf.operator);
        return `<strong>${showOp} ${valDollars}</strong>`;
      }

      if (leaf.scalar === 'DATE' && (leaf.operator === 'AGE_OLDER_THAN' || leaf.operator === 'AGE_YOUNGER_THAN')) {
        const N = Number(rawValStr || 0);
        const opMapNormal = { 'AGE_OLDER_THAN': '>', 'AGE_YOUNGER_THAN': '<' };
        const opMapInverted = { 'AGE_OLDER_THAN': '≤', 'AGE_YOUNGER_THAN': '≥' };
        const showOp = invert ? (opMapInverted[leaf.operator] || leaf.operator) : (opMapNormal[leaf.operator] || leaf.operator);
        return `<strong>Age ${showOp} ${N} years</strong>`;
      }

      const opNormal = { 'EQUAL_TO': '=', 'NOT_EQUAL_TO': '≠', 'GREATER_THAN': '>', 'GREATER_THAN_OR_EQUAL_TO': '≥', 'LESS_THAN': '<', 'LESS_THAN_OR_EQUAL_TO': '≤' };
      const opInverted = { 'EQUAL_TO': '≠', 'NOT_EQUAL_TO': '=', 'GREATER_THAN': '≤', 'GREATER_THAN_OR_EQUAL_TO': '<', 'LESS_THAN': '≥', 'LESS_THAN_OR_EQUAL_TO': '>' };
      const showOp = invert ? (opInverted[leaf.operator] || leaf.operator) : (opNormal[leaf.operator] || leaf.operator);
      const formattedVal = (rawValStr.startsWith('"') || rawValStr.startsWith('$') || !isNaN(Number(rawValStr))) ? rawValStr : `"${rawValStr}"`;

      return `<strong>${showOp} ${escapeHtml(formattedVal)}</strong>`;
    }

    // Dynamic Simulator State Management
    function initSimStateForProgram() {
      state.simValues = {};
      const questionsMap = getQuestionsMap();
      const blocks = state.formData.program?.blockDefinitions || [];

      blocks.forEach(b => {
        const leaves = [];
        if (b.eligibilityDefinition) leaves.push(...collectLeafNodes(b.eligibilityDefinition.predicate?.rootNode?.node));
        if (b.hidePredicate) leaves.push(...collectLeafNodes(b.hidePredicate.rootNode?.node));

        leaves.forEach(leaf => {
          if (leaf.questionId && state.simValues[leaf.questionId] === undefined) {
            const q = questionsMap.get(leaf.questionId);
            if (leaf.scalar === 'SELECTION' || leaf.scalar === 'SELECTIONS') {
              let parsed = [];
              try { parsed = JSON.parse(String(leaf.value?.value || '[]')).map(String); } catch (e) { parsed = [String(leaf.value?.value || '')]; }
              state.simValues[leaf.questionId] = parsed[0] || '0';
            } else if (leaf.scalar === 'CURRENCY_CENTS') {
              const cents = Number(leaf.value?.value || 0);
              // Set value to satisfy condition if eligibility, or show screen if hide
              state.simValues[leaf.questionId] = Math.round((cents / 100));
            } else if (leaf.scalar === 'DATE' && leaf.operator === 'AGE_OLDER_THAN') {
              state.simValues[leaf.questionId] = Number(leaf.value?.value || 59) + 5; // e.g. 65
            } else {
              state.simValues[leaf.questionId] = leaf.value?.value || '1';
            }
          }
        });

        if (isBlockEnumerator(b, questionsMap, blocks)) {
          state.simValues[`enum_block_${b.id}`] = 2;
        }
      });

      renderSimulatorControls();
    }

    function renderSimulatorControls() {
      const drawer = document.getElementById('sim-controls-drawer');
      if (!drawer) return;
      const questionsMap = getQuestionsMap();
      const blocks = state.formData.program?.blockDefinitions || [];

      const trackedQIds = new Set();
      let html = '';

      blocks.forEach((b, idx) => {
        const pageNum = idx + 1;
        const eligLeaves = collectLeafNodes(b.eligibilityDefinition?.predicate?.rootNode?.node);
        const hideLeaves = collectLeafNodes(b.hidePredicate?.rootNode?.node);

        eligLeaves.forEach(leaf => {
          if (!leaf.questionId || trackedQIds.has(leaf.questionId)) return;
          trackedQIds.add(leaf.questionId);
          const q = questionsMap.get(leaf.questionId);
          const qPrompt = getTranslation(q?.config?.questionText) || 'Eligibility Question';

          if (leaf.scalar === 'SELECTION' || leaf.scalar === 'SELECTIONS') {
            let allowed = [];
            try { allowed = JSON.parse(String(leaf.value?.value || '[]')).map(String); } catch(e) { allowed = [String(leaf.value?.value || '')]; }
            const opts = getQuestionOptions(q);

            html += `
              <div class="sim-box sim-box--eligibility">
                <div>
                  <span class="sim-label">Screen ${pageNum} Eligibility Gate: "${qPrompt}"</span>
                  <div class="sim-input-inline">
                    ${opts.map(opt => {
                      const isElig = allowed.includes(String(opt.id)) || allowed.includes(String(opt.adminName));
                      const isAct = String(state.simValues[leaf.questionId]) === String(opt.id) || String(state.simValues[leaf.questionId]) === String(opt.adminName);
                      const cls = isAct ? (isElig ? 'sim-preset-btn is-active' : 'sim-preset-btn is-stop-active') : 'sim-preset-btn';
                      const icon = isElig ? '✓' : '⛔';
                      return `<button type="button" class="${cls}" data-q-id="${leaf.questionId}" data-val="${opt.id}">${icon} "${getTranslation(opt.localizedOptionText)}" (${isElig ? 'Eligible' : 'Stops User'})</button>`;
                    }).join('')}
                  </div>
                </div>
              </div>
            `;
          } else if (leaf.scalar === 'DATE' && leaf.operator === 'AGE_OLDER_THAN') {
            const N = Number(leaf.value?.value || 0);
            const val = Number(state.simValues[leaf.questionId] || N + 5);
            const isElig = val > N;
            html += `
              <div class="sim-box sim-box--eligibility">
                <div>
                  <span class="sim-label">Screen ${pageNum} Eligibility Gate: "${qPrompt}" (Age &gt; ${N})</span>
                  <div class="sim-input-inline">
                    <button type="button" class="sim-preset-btn ${val > N ? 'is-active' : ''}" data-q-id="${leaf.questionId}" data-val="${N + 6}">
                      ✓ Age ${N + 6} (&gt; ${N} yrs — Eligible)
                    </button>
                    <button type="button" class="sim-preset-btn ${val <= N ? 'is-stop-active' : ''}" data-q-id="${leaf.questionId}" data-val="${Math.max(18, N - 5)}">
                      ⛔ Age ${Math.max(18, N - 5)} (&le; ${N} yrs — Stops User)
                    </button>
                  </div>
                </div>
              </div>
            `;
          }
        });

        hideLeaves.forEach(leaf => {
          if (!leaf.questionId || trackedQIds.has(leaf.questionId)) return;
          trackedQIds.add(leaf.questionId);
          const q = questionsMap.get(leaf.questionId);
          const qPrompt = getTranslation(q?.config?.questionText) || 'Visibility Question';

          if (leaf.scalar === 'SELECTION' || leaf.scalar === 'SELECTIONS') {
            let targetIds = [];
            try { targetIds = JSON.parse(String(leaf.value?.value || '[]')).map(String); } catch(e) { targetIds = [String(leaf.value?.value || '')]; }
            const opts = getQuestionOptions(q);
            const predAction = b.hidePredicate?.action || 'HIDE_BLOCK';
            const leafOp = leaf.operator || 'IN';

            html += `
              <div class="sim-box sim-box--highlight">
                <div>
                  <span class="sim-label">Simulate Answer: "${qPrompt}"</span>
                  <div class="sim-input-inline">
                    ${opts.map(opt => {
                      const inList = targetIds.includes(String(opt.id)) || targetIds.includes(String(opt.adminName));
                      const matchesLeaf = (leafOp === 'NOT_IN' || leafOp === 'NONE_OF') ? !inList : inList;
                      const showsScreen = predAction === 'HIDE_BLOCK' ? !matchesLeaf : matchesLeaf;
                      const isAct = String(state.simValues[leaf.questionId]) === String(opt.id) || String(state.simValues[leaf.questionId]) === String(opt.adminName);
                      const cls = isAct ? 'sim-preset-btn is-active' : 'sim-preset-btn';
                      return `<button type="button" class="${cls}" data-q-id="${leaf.questionId}" data-val="${opt.id}">"${getTranslation(opt.localizedOptionText)}" (${showsScreen ? `Shows Screen ${pageNum}` : `Hides Screen ${pageNum}`})</button>`;
                    }).join('')}
                  </div>
                </div>
              </div>
            `;
          } else if (leaf.scalar === 'CURRENCY_CENTS') {
            const targetDollars = Number(leaf.value?.value || 0) / 100;
            const currentDollars = Number(state.simValues[leaf.questionId] || targetDollars / 2);
            html += `
              <div class="sim-box sim-box--highlight">
                <div>
                  <span class="sim-label">Simulate Answer: "${qPrompt}"</span>
                  <div class="sim-input-inline">
                    <span class="text-bold font-sans-sm">$</span>
                    <input type="number" class="sim-currency-input sim-dynamic-input" data-q-id="${leaf.questionId}" value="${currentDollars}" min="0" step="1000">
                    <button type="button" class="sim-preset-btn ${currentDollars < targetDollars ? 'is-active' : ''}" data-q-id="${leaf.questionId}" data-val="${targetDollars * 0.5}">
                      &lt; $${targetDollars.toLocaleString()}
                    </button>
                    <button type="button" class="sim-preset-btn ${currentDollars >= targetDollars ? 'is-active' : ''}" data-q-id="${leaf.questionId}" data-val="${targetDollars * 1.25}">
                      &ge; $${targetDollars.toLocaleString()}
                    </button>
                  </div>
                </div>
              </div>
            `;
          }
        });

        if (isBlockEnumerator(b, questionsMap, blocks)) {
          const enumQ = (b.questionDefinitions || []).map(qd => questionsMap.get(qd.id)).find(q => q?.type === 'enumerator');
          const entityLabel = getTranslation(enumQ?.entityType) || 'Item';
          const currentCount = Number(state.simValues[`enum_block_${b.id}`] || 2);
          html += `
            <div class="sim-box">
              <div>
                <span class="sim-label">Screen ${pageNum} Enumerator: ${entityLabel} Count</span>
                <div class="sim-input-inline">
                  <button type="button" class="sim-preset-btn ${currentCount === 0 ? 'is-active' : ''}" data-enum-id="enum_block_${b.id}" data-val="0">0 ${entityLabel}s (Skip Repeaters)</button>
                  <button type="button" class="sim-preset-btn ${currentCount === 1 ? 'is-active' : ''}" data-enum-id="enum_block_${b.id}" data-val="1">1 ${entityLabel} (&times;1)</button>
                  <button type="button" class="sim-preset-btn ${currentCount === 2 ? 'is-active' : ''}" data-enum-id="enum_block_${b.id}" data-val="2">2 ${entityLabel}s (&times;2)</button>
                </div>
              </div>
            </div>
          `;
        }
      });

      drawer.innerHTML = html || '<span class="font-sans-xs text-base-dark">No conditional predicates or enumerators in this program.</span>';

      drawer.querySelectorAll('button[data-q-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const qId = btn.getAttribute('data-q-id');
          state.simValues[qId] = btn.getAttribute('data-val');
          renderSimulatorControls();
          renderJourneyTrail();
          renderFlowchart();
        });
      });

      drawer.querySelectorAll('button[data-enum-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const eId = btn.getAttribute('data-enum-id');
          state.simValues[eId] = Number(btn.getAttribute('data-val'));
          renderSimulatorControls();
          renderJourneyTrail();
          renderFlowchart();
        });
      });

      drawer.querySelectorAll('.sim-dynamic-input').forEach(inp => {
        inp.addEventListener('input', (e) => {
          const qId = inp.getAttribute('data-q-id');
          state.simValues[qId] = Number(e.target.value || 0);
          renderJourneyTrail();
          renderFlowchart();
        });
      });
    }

    function evaluateLeafNode(node) {
      if (!node || !node.questionId) return true;
      const userVal = state.simValues[node.questionId];
      if (userVal === undefined) return true;

      if (node.scalar === 'SELECTION' || node.scalar === 'SELECTIONS') {
        let allowed = [];
        try { allowed = JSON.parse(String(node.value?.value || '[]')).map(String); } catch(e) { allowed = [String(node.value?.value || '')]; }
        const matched = allowed.includes(String(userVal));
        return (node.operator === 'NOT_IN' || node.operator === 'NONE_OF') ? !matched : matched;
      }

      if (node.scalar === 'CURRENCY_CENTS' || node.scalar === 'CURRENCY') {
        const userCents = Math.round(Number(userVal) * 100);
        const targetCents = Number(node.value?.value || 0);
        if (node.operator === 'LESS_THAN') return userCents < targetCents;
        if (node.operator === 'GREATER_THAN_OR_EQUAL_TO') return userCents >= targetCents;
        if (node.operator === 'EQUAL_TO') return userCents === targetCents;
      }

      if (node.scalar === 'DATE' && node.operator === 'AGE_OLDER_THAN') {
        const age = Number(userVal);
        const targetAge = Number(node.value?.value || 0);
        return age > targetAge;
      }

      return true;
    }

    function evaluatePredicateTree(node) {
      if (!node) return true;
      if (node.questionId != null || node.type === 'leaf') {
        return evaluateLeafNode(node);
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        if (node.type === 'and') return node.children.every(c => evaluatePredicateTree(c.node || c));
        if (node.type === 'or') return node.children.some(c => evaluatePredicateTree(c.node || c));
      }
      return true;
    }

    function doesBlockPassEligibilityInSim(block) {
      if (!state.simulationEnabled) return true;
      const eligNode = block.eligibilityDefinition?.predicate?.rootNode?.node;
      if (!eligNode) return true;
      return evaluatePredicateTree(eligNode);
    }

    function isBlockVisibleInSim(block) {
      if (!state.simulationEnabled) return true;
      if (block.repeaterId != null) {
        const count = Number(state.simValues[`enum_block_${block.repeaterId}`] || 2);
        if (count === 0) return false;
      }
      const pred = block.hidePredicate || block.optionalPredicate;
      if (!pred || !pred.rootNode?.node) return true;
      const matched = evaluatePredicateTree(pred.rootNode.node);
      const action = pred.action || 'HIDE_BLOCK';
      return action === 'HIDE_BLOCK' ? !matched : matched;
    }

    function parseProgramDescriptionWithNotice(rawDesc) {
      const text = String(rawDesc || '').trim();
      if (!text) return { mainBody: '', noticeTitle: '', noticeBody: '' };
      const noticeMatch = text.match(/\*\*\*(Notice|Aviso|Important Notice|Aviso Importante)\s*:?\*\*\*\s*([\s\S]*)$/i);
      if (noticeMatch) {
        const idx = noticeMatch.index;
        return {
          mainBody: text.slice(0, idx).trim(),
          noticeTitle: (noticeMatch[1] || 'Notice').replace(/:$/, '').trim(),
          noticeBody: (noticeMatch[2] || '').trim()
        };
      }
      const lineNoticeMatch = text.match(/(?:^|\n)\s*\*\*(Notice|Aviso)\s*:?\*\*\s*([\s\S]*)$/i);
      if (lineNoticeMatch) {
        const idx = lineNoticeMatch.index;
        return {
          mainBody: text.slice(0, idx).trim(),
          noticeTitle: (lineNoticeMatch[1] || 'Notice').replace(/:$/, '').trim(),
          noticeBody: (lineNoticeMatch[2] || '').trim()
        };
      }
      return { mainBody: text, noticeTitle: '', noticeBody: '' };
    }

    function buildIntroCardsHTML() {
      const prog = state.formData.program || {};
      const progTitle = getTranslation(prog.localizedName) || 'CiviForm';
      const rawDesc = getTranslation(prog.localizedDescription);
      const { mainBody, noticeTitle, noticeBody } = parseProgramDescriptionWithNotice(rawDesc);
      const steps = Array.isArray(prog.applicationSteps) ? prog.applicationSteps : [];
      const isEs = String(state.locale || '').startsWith('es');

      let html = '';

      if (mainBody || noticeBody) {
        const applyHeading = isEs
          ? `Solicitar el programa ${escapeHtml(progTitle)}`
          : `Apply for ${escapeHtml(progTitle)} program`;
        html += `
          <div class="flow-step-row" id="flow-row-intro-description">
            <div class="flow-row__primary">
              <article class="cf-intro-card" id="flow-node-intro-description" aria-label="Program Description and Notice">
                <h3 class="cf-intro-card__program-title">${applyHeading}</h3>
                ${mainBody ? `<p class="cf-intro-card__desc">${escapeHtml(mainBody)}</p>` : ''}
                ${noticeBody ? `
                  <div class="cf-notice-box" role="region" aria-label="${escapeHtml(noticeTitle)}">
                    <svg class="cf-notice-box__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
                    </svg>
                    <p class="cf-notice-box__text">
                      <strong>${escapeHtml(noticeTitle)}:</strong> ${escapeHtml(noticeBody)}
                    </p>
                  </div>
                ` : ''}
              </article>
            </div>
          </div>
        `;
      }

      if (steps.length > 0) {
        html += `
          <div class="flow-step-row" id="flow-row-intro-steps">
            <div class="flow-row__primary">
              <article class="cf-intro-card" id="flow-node-intro-steps" aria-label="Steps to Apply">
                <h3 class="cf-intro-card__steps-title">${isEs ? 'C&oacute;mo solicitar' : 'How to apply'}</h3>
                <ol class="cf-process-list">
                  ${steps.map(st => `
                    <li class="cf-process-list__item">
                      <h4 class="cf-process-list__heading">${escapeHtml(getTranslation(st.title))}</h4>
                      <p class="cf-process-list__desc">${escapeHtml(getTranslation(st.description))}</p>
                    </li>
                  `).join('')}
                </ol>
              </article>
            </div>
          </div>
        `;
      }

      return html;
    }

    function renderProgramHeader() {
      const prog = state.formData.program || {};
      const blocks = prog.blockDefinitions || [];
      const questions = state.formData.questions || [];
      const steps = Array.isArray(prog.applicationSteps) ? prog.applicationSteps : [];
      const eligCount = blocks.filter(b => b.eligibilityDefinition).length;
      const hideCount = blocks.filter(b => b.hidePredicate || b.optionalPredicate).length;
      const repeaterBlocks = blocks.filter(b => b.repeaterId != null);

      const titleText = getTranslation(prog.localizedName) || 'CiviForm Program Flowchart';
      const descText = getTranslation(prog.localizedShortDescription) || getTranslation(prog.localizedDescription) || '';
      const titleHeadingEl = document.getElementById('program-title-heading') || document.getElementById('program-title');
      if (titleHeadingEl) titleHeadingEl.textContent = titleText;
      const descEl = document.getElementById('program-desc');
      if (descEl) descEl.textContent = descText;

      let pillsHTML = '';
      if (steps.length > 0) {
        pillsHTML += `<span class="meta-pill"><strong>Steps:</strong> ${steps.length}</span>`;
      }
      pillsHTML += `
        <span class="meta-pill"><strong>Screens:</strong> ${blocks.length}</span>
        <span class="meta-pill"><strong>Questions:</strong> ${questions.length}</span>
      `;
      if (eligCount > 0) {
        pillsHTML += `<span class="meta-pill"><strong>Eligibility conditions:</strong> ${eligCount}</span>`;
      }
      if (hideCount > 0) {
        pillsHTML += `<span class="meta-pill"><strong>Visibility branches:</strong> ${hideCount} Screens</span>`;
      }
      if (repeaterBlocks.length > 0) {
        pillsHTML += `<span class="meta-pill"><strong>Repeated Screens:</strong> ${repeaterBlocks.length} (Loop)</span>`;
      }
      const pillsEl = document.getElementById('program-meta-pills');
      if (pillsEl) pillsEl.innerHTML = pillsHTML;
    }

    function renderJourneyTrail() {
      const wrapper = document.getElementById('journey-strip-wrapper');
      const container = document.getElementById('active-journey-trail') || document.getElementById('journey-trail');
      if (!state.simulationEnabled) {
        if (wrapper) wrapper.classList.remove('is-open');
        if (container) container.innerHTML = '';
        return;
      }
      if (wrapper) wrapper.classList.add('is-open');

      const blocks = state.formData.program?.blockDefinitions || [];
      const steps = [];
      let stoppedAtScreen = null;

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (!isBlockVisibleInSim(b)) continue;

        const name = getTranslation(b.localizedName) || b.name;
        steps.push({
          label: `Screen ${i + 1}: ${name}`,
          kind: b.repeaterId ? 'loop' : ((b.hidePredicate || b.optionalPredicate) ? 'branch' : 'normal')
        });

        if (b.eligibilityDefinition && !doesBlockPassEligibilityInSim(b) && state.formData.program?.eligibilityIsGating !== false) {
          stoppedAtScreen = name;
          break;
        }
      }

      let html = `<span class="journey-strip__label">Simulated Applicant Journey:</span>`;
      steps.forEach((step, idx) => {
        const cls = step.kind === 'branch'
          ? 'journey-step-chip journey-step-chip--branch'
          : step.kind === 'loop'
            ? 'journey-step-chip journey-step-chip--loop'
            : 'journey-step-chip';
        html += `<span class="${cls}">${step.label}</span>`;
        if (idx < steps.length - 1) {
          html += `<span class="journey-arrow">→</span>`;
        }
      });

      if (stoppedAtScreen) {
        html += `<span class="journey-arrow">→</span><span class="journey-step-chip journey-step-chip--stop">⛔ STOPPED AT "${stoppedAtScreen}" (Ineligible)</span>`;
      } else {
        html += `<span class="journey-arrow">→</span><span class="journey-step-chip" style="background: rgba(0,189,227,0.25);">✓ Review &amp; Submit</span>`;
      }
      if (container) container.innerHTML = html;
    }

    function scrollToScreenNode(blockId) {
      const el = document.getElementById(`flow-node-screen-${blockId}`);
      if (!el) return;
      const simBar = document.querySelector('.simulator-bar, .sim-bar');
      const simBarHeight = simBar ? simBar.getBoundingClientRect().height : 0;
      const offset = simBarHeight + 24;
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = el.getBoundingClientRect().top;
      const elementPosition = elementRect - bodyRect;
      const offsetPosition = elementPosition - offset;

      window.scrollTo({
        top: Math.max(0, offsetPosition),
        behavior: 'smooth'
      });
    }

    function renderOutlineList() {
      const container = document.getElementById('canvas-outline-list');
      if (!container) return;

      const blocks = state.formData.program?.blockDefinitions || [];
      const questionsMap = getQuestionsMap();
      const allBlocks = blocks;
      let html = '';
      let stoppedAtBlockId = null;

      if (state.simulationEnabled && state.formData.program?.eligibilityIsGating !== false) {
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          if (!isBlockVisibleInSim(b)) continue;
          if (b.eligibilityDefinition && !doesBlockPassEligibilityInSim(b)) {
            stoppedAtBlockId = b.id;
            break;
          }
        }
      }

      let blockedUpstream = false;

      blocks.forEach((block, idx) => {
        const pageNum = idx + 1;
        const name = getTranslation(block.localizedName) || block.name;
        const hasEligibility = !!block.eligibilityDefinition;
        const hasVisibilityPred = !!(block.hidePredicate || block.optionalPredicate);
        const isRepeatedPage = !!block.repeaterId;
        const isVisibleInSim = isBlockVisibleInSim(block);

        let isHidden = false;
        let isStop = false;

        if (state.simulationEnabled) {
          if (blockedUpstream || !isVisibleInSim) {
            isHidden = true;
          } else if (stoppedAtBlockId && block.id === stoppedAtBlockId) {
            isStop = true;
            blockedUpstream = true;
          }
        }

        let itemCls = 'outline-item';
        let badgeHTML = '';

        if (isHidden) {
          itemCls += ' outline-item--hidden';
          badgeHTML = `<span class="outline-item__tag outline-item__tag--hidden">Hidden</span>`;
        } else if (isStop || hasEligibility) {
          badgeHTML = `<span class="outline-item__tag outline-item__tag--stop">E</span>`;
        } else if (hasVisibilityPred) {
          itemCls += ' outline-item--visibility';
          badgeHTML = `<span class="outline-item__tag outline-item__tag--visibility">V</span>`;
        } else if (isRepeatedPage) {
          itemCls += ' outline-item--loop';
          badgeHTML = `<span class="outline-item__tag outline-item__tag--loop">N</span>`;
        }

        html += `
          <li>
            <a class="${itemCls}" href="#flow-node-screen-${block.id}" onclick="scrollToScreenNode(${block.id}); return false;">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(name)}</span>
              ${badgeHTML}
            </a>
          </li>
        `;
      });

      container.innerHTML = html;
    }

    function initOutlineToggle() {
      const toggleBtn = document.getElementById('canvas-outline-toggle-btn');
      const outlineContainer = document.getElementById('canvas-outline-container');
      if (!toggleBtn || !outlineContainer) return;

      toggleBtn.addEventListener('click', () => {
        const collapsed = outlineContainer.classList.toggle('is-collapsed');
        toggleBtn.setAttribute('aria-expanded', !collapsed);
      });

      toggleBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const collapsed = outlineContainer.classList.toggle('is-collapsed');
          toggleBtn.setAttribute('aria-expanded', !collapsed);
        }
      });
    }

    function buildScreenCardHTML(block, pageIndex, questionsMap, allBlocks, isBlockedUpstream = false, branchLabel = null) {
      const visibleByHide = isBlockVisibleInSim(block);
      const visible = !isBlockedUpstream && visibleByHide;
      const predInfo = describePredicate(block, questionsMap);
      const eligInfo = describeEligibility(block, questionsMap);
      const isEnum = isBlockEnumerator(block, questionsMap, allBlocks);
      const screenTitle = getTranslation(block.localizedName) || block.name;
      const screenDesc = getTranslation(block.localizedDescription) || block.description;

      let cardClasses = ['screen-node'];
      if (!state.simulationEnabled) {
        cardClasses.push('is-default-path');
      } else if (visible) {
        cardClasses.push('is-active-path');
      } else {
        cardClasses.push('is-hidden-path');
      }
      const hasVisibilityPred = !!(block.hidePredicate || block.optionalPredicate);
      if (hasVisibilityPred) cardClasses.push('screen-node--visibility');
      else if (block.repeaterId) cardClasses.push('screen-node--repeater');

      let statusBadgeHTML = '';
      if (!state.simulationEnabled) {
        statusBadgeHTML = '';
      } else {
        if (isBlockedUpstream) {
          statusBadgeHTML = `<span class="status-badge status-badge--hidden">BLOCKED (STOPPED EARLIER)</span>`;
        } else if (!visibleByHide) {
          statusBadgeHTML = `<span class="status-badge status-badge--hidden">HIDDEN BY CONDITION</span>`;
        } else if (eligInfo && !doesBlockPassEligibilityInSim(block)) {
          statusBadgeHTML = `<span class="status-badge status-badge--eligibility">FAILS ELIGIBILITY HERE</span>`;
        } else {
          statusBadgeHTML = `<span class="status-badge status-badge--active">✓ ACTIVE ON PATH</span>`;
        }
      }

      let topBannerHTML = '';
      if (block.hidePredicate || block.optionalPredicate) {
        const predObj = block.hidePredicate || block.optionalPredicate;
        const rootNode = predObj?.rootNode?.node;
        const invertPred = (predObj?.action || 'HIDE_BLOCK') === 'HIDE_BLOCK';
        const tagText = branchLabel ? `CONDITIONALLY VISIBLE &bull; BRANCH ${branchLabel}` : `CONDITIONALLY VISIBLE`;

        if (rootNode) {
          const rootIsCompound = Array.isArray(rootNode.children) && rootNode.children.length > 0;

          if (rootIsCompound) {
            const predFormatted = formatPredicateNode(rootNode, questionsMap, invertPred, true);
            const isAndAtRoot = (rootNode.type === 'and' ? !invertPred : invertPred);
            let matchPhrase = 'Screen displays when conditions match:';
            if (!isAndAtRoot) {
              const numGroups = rootNode.children.length;
              const groupLabels = Array.from({length: numGroups}, (_, i) => `Group ${i + 1}`).join(' OR ');
              matchPhrase = `Screen displays when <strong>EITHER ${groupLabels}</strong> matches:`;
            } else {
              matchPhrase = `Screen displays when <strong>ALL conditions</strong> match:`;
            }

            topBannerHTML = `
              <div class="screen-predicate-banner--visibility-top">
                <div style="margin-bottom: 0.15rem;">
                  <span class="status-badge-tag--visibility">${tagText}</span>
                </div>
                <div style="font-size: 0.8rem; color: #1f2937; margin-bottom: 0.25rem;">
                  ${matchPhrase}
                </div>
                ${predFormatted}
              </div>
            `;
          } else {
            const predFormatted = formatPredicateNode(rootNode, questionsMap, invertPred, true, 'Visible when ');
            topBannerHTML = `
              <div class="screen-predicate-banner--visibility-top">
                <div style="margin-bottom: 0.15rem;">
                  <span class="status-badge-tag--visibility">${tagText}</span>
                </div>
                ${predFormatted}
              </div>
            `;
          }
        }
      } else if (block.repeaterId) {
        const parentIdx = allBlocks.findIndex(b => b.id === block.repeaterId) + 1;
        const parentBlock = allBlocks.find(b => b.id === block.repeaterId);
        const enumQ = (parentBlock?.questionDefinitions || []).map(qd => questionsMap.get(qd.id)).find(q => q?.type === 'enumerator');
        const entityLabel = getTranslation(enumQ?.entityType) || 'item';

        topBannerHTML = `
          <div class="screen-predicate-banner--repeater-top">
            <div style="margin-bottom: 0.15rem;">
              <span class="status-badge-tag--repeater">REPEATED SCREEN</span>
            </div>
            <div style="font-size: 0.8rem; color: #1f2937;">
              Repeated once for each <strong>"${escapeHtml(entityLabel)}"</strong> added on <strong>Screen ${parentIdx}</strong>
            </div>
          </div>
        `;
      }

      const visibilityTriggerQIds = getAllVisibilityTriggerQuestionIds(allBlocks);
      const eligLeaves = collectLeafNodes(block.eligibilityDefinition?.predicate?.rootNode?.node);
      const eligQuestionIds = new Set(eligLeaves.map(l => l.questionId != null ? String(l.questionId) : null).filter(Boolean));

      const qDefs = block.questionDefinitions || [];
      let questionsHTML = '';
      qDefs.forEach(qd => {
        const q = questionsMap.get(qd.id);
        if (!q) return;
        const qText = getTranslation(q.config?.questionText) || 'Question';
        const qHelp = getTranslation(q.config?.questionHelpText);
        const qType = (q.type || 'text').toUpperCase();
        const isEligibilityQuestion = eligQuestionIds.has(String(qd.id)) || (eligInfo && String(eligInfo.questionId) === String(qd.id));
        const isVisibilityTriggerQuestion = visibilityTriggerQIds.has(String(qd.id));
        const isEnumeratorQuestion = (q.type === 'enumerator');
        const isUniversalQuestion = Boolean(
          q.config?.universal ||
          q.universal ||
          (Array.isArray(q.config?.questionTagList) && q.config.questionTagList.includes('UNIVERSAL')) ||
          (Array.isArray(q.questionTagList) && q.questionTagList.includes('UNIVERSAL'))
        );
        const isSharedQuestion = Boolean(
          q.config?.isSharedQuestion ||
          q.isSharedQuestion ||
          q.config?.isShared ||
          q.isShared ||
          q.config?.shared ||
          q.shared ||
          Boolean(q.sharedKey) ||
          Boolean(q.config?.sharedKey) ||
          (Array.isArray(q.config?.questionTagList) && (q.config.questionTagList.includes('SHARED') || q.config.questionTagList.includes('SHARED_QUESTION'))) ||
          (Array.isArray(q.questionTagList) && (q.questionTagList.includes('SHARED') || q.questionTagList.includes('SHARED_QUESTION'))) ||
          /_shared_/i.test(String(q.id || '')) ||
          /_shared_/i.test(String(q.config?.name || '')) ||
          /_shared_/i.test(String(q.name || '')) ||
          /_shared_/i.test(String(qd.id || '')) ||
          (Array.isArray(state.formData?.sharedQuestionIds) && (
            state.formData.sharedQuestionIds.includes(qd.id) ||
            state.formData.sharedQuestionIds.includes(String(qd.id)) ||
            state.formData.sharedQuestionIds.includes(Number(qd.id)) ||
            (q.config?.id != null && state.formData.sharedQuestionIds.includes(q.config.id)) ||
            (q.id != null && state.formData.sharedQuestionIds.includes(q.id))
          )) ||
          (Array.isArray(state.formData?.sharedQuestionNames) && (
            (q.config?.name && state.formData.sharedQuestionNames.includes(q.config.name)) ||
            (q.name && state.formData.sharedQuestionNames.includes(q.name)) ||
            state.formData.sharedQuestionNames.includes(String(qd.id))
          ))
        );

        let typeClass = 'q-type-tag';
        if (q.type === 'currency' || q.type === 'date') typeClass += ' q-type-tag--currency';
        else if (q.type === 'multioption') typeClass += ' q-type-tag--multioption';
        else if (q.type === 'static') typeClass += ' q-type-tag--static';
        else if (q.type === 'enumerator') typeClass += ' q-type-tag--enumerator';

        let optionsDetailsHTML = '';
        const opts = getQuestionOptions(q);
        if (opts.length > 0) {
          const optionPills = opts.map(opt => {
            let pillCls = 'option-pill-item';
            if (isEligibilityQuestion && eligInfo && eligInfo.allowedOptionIds) {
              if (eligInfo.allowedOptionIds.includes(String(opt.id)) || eligInfo.allowedOptionIds.includes(String(opt.adminName))) {
                pillCls += ' option-pill-item--eligible';
              } else {
                pillCls += ' option-pill-item--ineligible';
              }
            }
            const prefix = isEligibilityQuestion && eligInfo && eligInfo.allowedOptionIds
              ? ((eligInfo.allowedOptionIds.includes(String(opt.id)) || eligInfo.allowedOptionIds.includes(String(opt.adminName))) ? '✓ Eligible: ' : 'Stops User: ')
              : '';
            return `<span class="${pillCls}">${prefix}${getTranslation(opt.localizedOptionText)}</span>`;
          }).join('');

          const openAttr = isEligibilityQuestion ? 'open' : '';
          optionsDetailsHTML = `
            <details class="question-options-details" ${openAttr}>
              <summary>${opts.length} answer options (${q.multiOptionQuestionType || 'SELECT'})</summary>
              <div class="question-options-pills">${optionPills}</div>
            </details>
          `;
        }

        let chipModClass = '';

        const hasMeta = isUniversalQuestion || isSharedQuestion || isEnumeratorQuestion || isVisibilityTriggerQuestion || isEligibilityQuestion || !qd.optional;
        const universalIconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true" style="flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.24 16L12 15.45 7.77 18l1.12-4.81-3.73-3.23 4.92-.42L12 5l1.92 4.53 4.92.42-3.73 3.23L16.24 18z"/></svg>`;
        const sharedIconSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true" style="flex-shrink:0;"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg>`;
        const metaHTML = hasMeta ? `
            <div class="question-chip__top">
              <div class="question-chip__meta">
                ${isUniversalQuestion ? `<span class="q-universal-pill" title="CiviForm Universal Question">${universalIconSvg}UNIVERSAL QUESTION</span>` : ''}
                ${isSharedQuestion ? `<span class="q-shared-pill" title="Shared question across programs">${sharedIconSvg}SHARED QUESTION</span>` : ''}
                ${isEnumeratorQuestion ? `<span class="q-enumerator-pill">ENUMERATOR</span>` : ''}
                ${isVisibilityTriggerQuestion ? `<span class="q-visibility-pill">CONTROLS VISIBILITY</span>` : ''}
                ${isEligibilityQuestion ? `<span class="q-eligibility-pill">CONTROLS ELIGIBILITY</span>` : ''}
                ${!qd.optional ? '<span class="q-badge-tag" style="background:#f4e3db;color:#b50909;">Required</span>' : ''}
              </div>
            </div>
        ` : '';

        let eligBannerHTML = '';
        if (isEligibilityQuestion && eligInfo) {
          const reqText = formatEligibilityRequirement(block.eligibilityDefinition?.predicate?.rootNode?.node, questionsMap);
          eligBannerHTML = `
            <div class="screen-predicate-banner screen-predicate-banner--eligibility">
              <span>${reqText}</span>
            </div>
          `;
        }

        questionsHTML += `
          <div class="question-chip ${chipModClass}" id="flow-node-question-${block.id}-${qd.id}" data-question-id="${qd.id}" data-block-id="${block.id}">
            ${metaHTML}
            <p class="question-chip__text">${qText}</p>
            ${qHelp ? `<p class="question-chip__help">${qHelp}</p>` : ''}
            ${optionsDetailsHTML}
            ${eligBannerHTML}
          </div>
        `;
      });

      return `
        <article class="${cardClasses.join(' ')}" id="flow-node-screen-${block.id}" data-block-id="${block.id}">
          ${topBannerHTML}
          <div class="screen-node__header">
            <div>
              <h3 class="screen-node__title">${screenTitle}</h3>
              ${screenDesc ? `<p class="screen-node__desc">${screenDesc}</p>` : ''}
            </div>
            ${statusBadgeHTML}
          </div>
          <div class="screen-questions-list">
            ${questionsHTML}
          </div>
        </article>
      `;
    }

    function buildEligibilityForkHTML(block, pageIndex, questionsMap, isBlockedUpstream, triggerQId = '') {
      const eligInfo = describeEligibility(block, questionsMap);
      if (!eligInfo) return '';

      const passesSim = !isBlockedUpstream && doesBlockPassEligibilityInSim(block);
      const stopsSim = !isBlockedUpstream && state.simulationEnabled && !doesBlockPassEligibilityInSim(block);

      const passCardCls = state.simulationEnabled && !passesSim
        ? 'eligibility-pass-card is-blocked'
        : 'eligibility-pass-card';

      let stopCardCls = 'eligibility-stop-card';
      if (stopsSim) stopCardCls += ' is-triggered-stop';
      else if (state.simulationEnabled && !stopsSim) stopCardCls += ' is-inactive-stop';

      const isGating = state.formData.program?.eligibilityIsGating !== false;
      const passExpr = state.predicateNotation === 'effective' ? eligInfo.effectivePassText : eligInfo.rawText;
      const stopExpr = eligInfo.effectiveStopText;
      const qIdAttr = triggerQId || eligInfo.questionId || '';

      return `
        <div class="flow-side-item eligibility-fork-row" id="elig-fork-row-${block.id}" data-elig-block="${block.id}" data-trigger-q-id="${qIdAttr}">
          <div class="${passCardCls}" id="elig-pass-node-${block.id}">
            <span class="eligibility-pass-card__badge">✓ Eligible</span>
            <h4 class="eligibility-pass-card__title">Proceed to Next Screen</h4>
            <code class="eligibility-pass-card__expr">${passExpr}</code>
          </div>
          <div class="${stopCardCls}" id="elig-stop-node-${block.id}">
            <span class="eligibility-stop-card__badge">${isGating ? '✕ Ineligible' : '⚠️ Non-Gating Warning'}</span>
            <h4 class="eligibility-stop-card__title">${isGating ? 'User Stopped (Does Not Match Eligibility)' : 'Eligibility Warning Shown'}</h4>
            <code class="eligibility-stop-card__expr">${stopExpr}</code>
          </div>
        </div>
      `;
    }

    function getBlockSingleLeaf(block) {
      const pred = block.hidePredicate || block.optionalPredicate;
      const rootNode = pred?.rootNode?.node;
      if (!rootNode) return null;
      if (Array.isArray(rootNode.children) && rootNode.children.length > 0) return null;
      const leaves = collectLeafNodes(rootNode);
      if (leaves.length !== 1 || leaves[0].questionId == null) return null;
      return { leaf: leaves[0], action: pred.action || 'HIDE_BLOCK' };
    }

    function getEffectiveVisibilityOperator(operator, action) {
      const invert = (action === 'HIDE_BLOCK');
      if (!invert) return operator;
      const invertMap = {
        'LESS_THAN': 'GREATER_THAN_OR_EQUAL_TO',
        'GREATER_THAN_OR_EQUAL_TO': 'LESS_THAN',
        'LESS_THAN_OR_EQUAL_TO': 'GREATER_THAN',
        'GREATER_THAN': 'LESS_THAN_OR_EQUAL_TO',
        'EQUAL_TO': 'NOT_EQUAL_TO',
        'NOT_EQUAL_TO': 'EQUAL_TO',
        'IN': 'NOT_IN',
        'NOT_IN': 'IN',
        'ANY_OF': 'NONE_OF',
        'NONE_OF': 'ANY_OF',
        'AGE_OLDER_THAN': 'AGE_YOUNGER_THAN',
        'AGE_YOUNGER_THAN': 'AGE_OLDER_THAN'
      };
      return invertMap[operator] || `NOT_${operator}`;
    }

    function isTrueParallelBranchGroup(branchGroup, questionsMap) {
      if (!Array.isArray(branchGroup) || branchGroup.length < 2) return false;
      const singleLeaves = branchGroup.map(b => getBlockSingleLeaf(b));
      if (singleLeaves.some(item => !item)) return false;

      const qId = String(singleLeaves[0].leaf.questionId);
      if (!singleLeaves.every(item => String(item.leaf.questionId) === qId)) return false;

      // Case 1: 2-branch complementary comparison on the same value
      if (branchGroup.length === 2) {
        const l0 = singleLeaves[0];
        const l1 = singleLeaves[1];
        const val0 = String(l0.leaf.value?.value ?? '').trim();
        const val1 = String(l1.leaf.value?.value ?? '').trim();
        const op0 = getEffectiveVisibilityOperator(l0.leaf.operator, l0.action);
        const op1 = getEffectiveVisibilityOperator(l1.leaf.operator, l1.action);
        const compPairs = [
          ['LESS_THAN', 'GREATER_THAN_OR_EQUAL_TO'],
          ['LESS_THAN_OR_EQUAL_TO', 'GREATER_THAN'],
          ['EQUAL_TO', 'NOT_EQUAL_TO'],
          ['IN', 'NOT_IN'],
          ['ANY_OF', 'NONE_OF'],
          ['AGE_OLDER_THAN', 'AGE_YOUNGER_THAN']
        ];
        if (val0 === val1) {
          const isComp = compPairs.some(([a, b]) => (op0 === a && op1 === b) || (op0 === b && op1 === a));
          if (isComp) return true;
        }
      }

      // Case 2: Multi-option question partition (mutually exclusive & exhaustive)
      const q = questionsMap.get(qId);
      const allOpts = getQuestionOptions(q);
      if (allOpts.length >= 2 && singleLeaves.every(item => item.leaf.scalar === 'SELECTION' || item.leaf.scalar === 'SELECTIONS')) {
        const branchOptSets = singleLeaves.map(item => {
          let parsed = [];
          try {
            parsed = JSON.parse(String(item.leaf.value?.value || '[]')).map(String);
          } catch (e) {
            parsed = [String(item.leaf.value?.value || '')];
          }
          const matchedOpts = allOpts.filter(opt => parsed.includes(String(opt.id)) || parsed.includes(String(opt.adminName)));
          return new Set(matchedOpts.map(opt => String(opt.id)));
        });

        if (branchOptSets.some(s => s.size === 0)) return false;
        const seen = new Set();
        for (const s of branchOptSets) {
          for (const id of s) {
            if (seen.has(id)) return false;
            seen.add(id);
          }
        }
        if (seen.size === allOpts.length) return true;
      }

      return false;
    }

    function classifyProgramBlocks(blocks, questionsMap) {
      const parallelGroupsByFirstBlockId = new Map();
      const parallelBlockIds = new Set();
      const sideConditionalBlockIds = new Set();
      const sideBlocksByHostId = new Map();

      let i = 0;
      while (i < blocks.length) {
        const b = blocks[i];
        const sl = getBlockSingleLeaf(b);
        if (sl && i + 1 < blocks.length) {
          const qId = String(sl.leaf.questionId);
          const candidateGroup = [b];
          let j = i + 1;
          while (j < blocks.length) {
            const nextB = blocks[j];
            if (nextB.repeaterId !== b.repeaterId) break;
            const nextSl = getBlockSingleLeaf(nextB);
            if (nextSl && String(nextSl.leaf.questionId) === qId) {
              candidateGroup.push(nextB);
              j++;
            } else {
              break;
            }
          }
          if (candidateGroup.length >= 2 && isTrueParallelBranchGroup(candidateGroup, questionsMap)) {
            parallelGroupsByFirstBlockId.set(b.id, candidateGroup);
            candidateGroup.forEach(cb => parallelBlockIds.add(cb.id));
            i = j;
            continue;
          }
        }
        i++;
      }

      blocks.forEach(b => {
        if (!parallelBlockIds.has(b.id) && (b.hidePredicate || b.optionalPredicate)) {
          sideConditionalBlockIds.add(b.id);
        }
      });

      const questionToBlockId = new Map();
      blocks.forEach(b => {
        (b.questionDefinitions || []).forEach(qd => {
          questionToBlockId.set(String(qd.id), b.id);
        });
      });

      const blockIndexMap = new Map();
      blocks.forEach((b, idx) => blockIndexMap.set(b.id, idx));

      const resolvedHostForBlock = new Map();
      function resolvePrimaryHostBlockId(bId, visited = new Set()) {
        if (resolvedHostForBlock.has(bId)) return resolvedHostForBlock.get(bId);
        if (!sideConditionalBlockIds.has(bId)) {
          resolvedHostForBlock.set(bId, bId);
          return bId;
        }
        if (visited.has(bId)) return null;
        visited.add(bId);
        const bObj = blocks.find(x => x.id === bId);
        const leaves = collectLeafNodes((bObj?.hidePredicate || bObj?.optionalPredicate)?.rootNode?.node);
        const candidateHosts = [];
        leaves.forEach(l => {
          if (l.questionId == null) return;
          const ownerBId = questionToBlockId.get(String(l.questionId));
          if (ownerBId != null) {
            const rootHost = resolvePrimaryHostBlockId(ownerBId, visited);
            if (rootHost != null) candidateHosts.push(rootHost);
          }
        });
        let chosenHost = null;
        if (candidateHosts.length > 0) {
          candidateHosts.sort((a, b) => (blockIndexMap.get(a) ?? 0) - (blockIndexMap.get(b) ?? 0));
          chosenHost = candidateHosts[candidateHosts.length - 1];
        } else {
          const myIdx = blockIndexMap.get(bId) ?? 0;
          for (let k = myIdx - 1; k >= 0; k--) {
            if (!sideConditionalBlockIds.has(blocks[k].id)) {
              chosenHost = blocks[k].id;
              break;
            }
          }
          if (chosenHost == null) {
            const firstPrimary = blocks.find(x => !sideConditionalBlockIds.has(x.id));
            chosenHost = firstPrimary ? firstPrimary.id : bId;
          }
        }
        resolvedHostForBlock.set(bId, chosenHost);
        return chosenHost;
      }

      blocks.forEach((b, idx) => {
        if (!sideConditionalBlockIds.has(b.id)) return;
        const hostId = resolvePrimaryHostBlockId(b.id);
        const hostBlock = blocks.find(x => x.id === hostId);
        const hostQIds = (hostBlock?.questionDefinitions || []).map(qd => String(qd.id));
        const leaves = collectLeafNodes((b.hidePredicate || b.optionalPredicate)?.rootNode?.node);
        const leafQIds = Array.from(new Set(leaves.map(l => l.questionId != null ? String(l.questionId) : null).filter(Boolean)));

        const triggerQIdOnHost = leafQIds.find(qId => hostQIds.includes(qId)) || leafQIds[0] || '';
        let qOrderIdx = hostQIds.indexOf(triggerQIdOnHost);
        if (qOrderIdx === -1) qOrderIdx = 999;

        if (!sideBlocksByHostId.has(hostId)) {
          sideBlocksByHostId.set(hostId, []);
        }
        sideBlocksByHostId.get(hostId).push({
          block: b,
          pageNum: idx + 1,
          triggerQId: triggerQIdOnHost,
          allTriggerQIds: leafQIds,
          qOrderIdx
        });
      });

      return {
        parallelGroupsByFirstBlockId,
        parallelBlockIds,
        sideConditionalBlockIds,
        sideBlocksByHostId
      };
    }

    function buildPrimaryRowHTML(block, pageNum, questionsMap, blocks, isBlockedUpstream, classification) {
      const hostQIds = (block.questionDefinitions || []).map(qd => String(qd.id));
      const sideItems = [];

      if (block.eligibilityDefinition) {
        const eligLeaves = collectLeafNodes(block.eligibilityDefinition?.predicate?.rootNode?.node);
        const eligQIds = eligLeaves.map(l => l.questionId != null ? String(l.questionId) : null).filter(Boolean);
        const firstEligQId = eligQIds.find(qId => hostQIds.includes(qId)) || eligQIds[0] || '';
        let eligOrderIdx = hostQIds.indexOf(firstEligQId);
        if (eligOrderIdx === -1) eligOrderIdx = 0;

        sideItems.push({
          type: 'eligibility',
          qOrderIdx: eligOrderIdx,
          pageNum: 0,
          html: buildEligibilityForkHTML(block, pageNum, questionsMap, isBlockedUpstream, firstEligQId)
        });
      }

      const condList = classification.sideBlocksByHostId.get(block.id) || [];
      condList.forEach(condEntry => {
        const condBlock = condEntry.block;
        const condPageNum = condEntry.pageNum;
        const condEligLeaves = collectLeafNodes(condBlock.eligibilityDefinition?.predicate?.rootNode?.node);
        const condEligQId = condEligLeaves[0]?.questionId != null ? String(condEligLeaves[0].questionId) : '';

        const condCardHTML = `
          <div class="flow-side-item conditional-side-item" id="cond-side-wrap-${condBlock.id}" data-cond-block-id="${condBlock.id}" data-trigger-q-id="${condEntry.triggerQId || ''}">
            ${buildScreenCardHTML(condBlock, condPageNum, questionsMap, blocks, isBlockedUpstream)}
            ${condBlock.eligibilityDefinition ? buildEligibilityForkHTML(condBlock, condPageNum, questionsMap, isBlockedUpstream, condEligQId) : ''}
          </div>
        `;
        sideItems.push({
          type: 'conditional',
          qOrderIdx: condEntry.qOrderIdx,
          pageNum: condPageNum,
          html: condCardHTML
        });
      });

      sideItems.sort((a, b) => {
        if (a.qOrderIdx !== b.qOrderIdx) return a.qOrderIdx - b.qOrderIdx;
        return (a.pageNum || 0) - (b.pageNum || 0);
      });

      return `
        <div class="flow-step-row" id="flow-row-screen-${block.id}" data-row-block-id="${block.id}">
          <div class="flow-row__primary">
            ${buildScreenCardHTML(block, pageNum, questionsMap, blocks, isBlockedUpstream)}
          </div>
          ${sideItems.length > 0 ? `<div class="flow-row__side">${sideItems.map(s => s.html).join('')}</div>` : ''}
        </div>
      `;
    }

    function renderFlowchart() {
      const container = document.getElementById('flowchart-nodes');
      const questionsMap = getQuestionsMap();
      const blocks = state.formData.program?.blockDefinitions || [];
      const classification = classifyProgramBlocks(blocks, questionsMap);

      let html = `
        ${buildIntroCardsHTML()}
        <div class="flow-terminal-row">
          <div class="terminal-node" id="flow-node-start">
            <span>Start application</span>
          </div>
        </div>
      `;

      let isBlockedUpstream = false;
      let i = 0;

      while (i < blocks.length) {
        const block = blocks[i];

        // Skip non-parallel conditional pages here; they are rendered to the right of their host primary page card
        if (classification.sideConditionalBlockIds.has(block.id)) {
          i++;
          continue;
        }

        // True Parallel Visibility Branch Group (rendered inline with primary serial workflow)
        if (classification.parallelGroupsByFirstBlockId.has(block.id)) {
          const branchGroup = classification.parallelGroupsByFirstBlockId.get(block.id);
          const triggerQIds = new Set();
          branchGroup.forEach(bBlock => {
            const leaves = collectLeafNodes((bBlock.hidePredicate || bBlock.optionalPredicate)?.rootNode?.node);
            leaves.forEach(l => {
              if (l.questionId != null) triggerQIds.add(String(l.questionId));
            });
          });

          let questionsHTML = '';
          triggerQIds.forEach(qId => {
            const q = questionsMap.get(qId);
            const qPrompt = getQuestionTextPrompt(q, qId);
            const qPageRef = getQuestionPageRef(qId);
            questionsHTML += `
              <div style="margin-top: 0.45rem; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                <code class="decision-gate__code" style="margin-top:0;">"${escapeHtml(qPrompt)}"</code>${qPageRef}
              </div>
            `;
          });

          let branchColsHTML = '';
          branchGroup.forEach((bBlock, bIdx) => {
            const pageNum = blocks.indexOf(bBlock) + 1;
            const branchLetter = String.fromCharCode(65 + bIdx);
            const branchSideConds = (classification.sideBlocksByHostId.get(bBlock.id) || []).map(condEntry => `
              <div class="flow-side-item conditional-side-item" id="cond-side-wrap-${condEntry.block.id}" data-cond-block-id="${condEntry.block.id}" data-trigger-q-id="${condEntry.triggerQId || ''}">
                ${buildScreenCardHTML(condEntry.block, condEntry.pageNum, questionsMap, blocks, isBlockedUpstream)}
                ${condEntry.block.eligibilityDefinition ? buildEligibilityForkHTML(condEntry.block, condEntry.pageNum, questionsMap, isBlockedUpstream) : ''}
              </div>
            `).join('');

            branchColsHTML += `
              <div class="branch-column">
                ${buildScreenCardHTML(bBlock, pageNum, questionsMap, blocks, isBlockedUpstream, branchLetter)}
                ${bBlock.eligibilityDefinition ? buildEligibilityForkHTML(bBlock, pageNum, questionsMap, isBlockedUpstream) : ''}
                ${branchSideConds}
              </div>
            `;
          });

          html += `
            <div class="decision-gate" id="flow-node-gate-${block.id}">
              <h3 class="decision-gate__title">Conditional visibility routing:</h3>
              ${questionsHTML}
            </div>
            <div class="branch-row" id="flow-branch-row-${block.id}">
              ${branchColsHTML}
            </div>
          `;
          i += branchGroup.length;
          continue;
        }

        // Repeater Group Container
        if (block.repeaterId != null) {
          const repeaterParentId = block.repeaterId;
          const groupBlocks = [];
          while (i < blocks.length && blocks[i].repeaterId === repeaterParentId) {
            if (!classification.sideConditionalBlockIds.has(blocks[i].id)) {
              groupBlocks.push({ block: blocks[i], pageNum: i + 1 });
            }
            i++;
          }

          if (groupBlocks.length > 0) {
            let innerGroupHTML = '';
            groupBlocks.forEach(item => {
              innerGroupHTML += buildPrimaryRowHTML(item.block, item.pageNum, questionsMap, blocks, isBlockedUpstream, classification);
              if (item.block.eligibilityDefinition) {
                if (state.simulationEnabled && !doesBlockPassEligibilityInSim(item.block) && state.formData.program?.eligibilityIsGating !== false) {
                  isBlockedUpstream = true;
                }
              }
            });

            html += `
              <section class="repeater-group-box ${isBlockedUpstream && state.simulationEnabled ? 'is-blocked' : ''}" id="repeater-group-${repeaterParentId}">
                ${innerGroupHTML}
              </section>
            `;
          }
          continue;
        }

        // Primary Page Row (left-aligned primary card + right-side eligibility / conditional cards)
        html += buildPrimaryRowHTML(block, i + 1, questionsMap, blocks, isBlockedUpstream, classification);
        if (block.eligibilityDefinition) {
          if (state.simulationEnabled && !doesBlockPassEligibilityInSim(block) && state.formData.program?.eligibilityIsGating !== false) {
            isBlockedUpstream = true;
          }
        }
        i++;
      }

      html += `
        <div class="flow-terminal-row">
          <div class="terminal-node ${isBlockedUpstream ? 'is-blocked' : ''}" id="flow-node-end">
            <span>✓ Review &amp; Submit Application</span>
          </div>
        </div>
      `;

      container.innerHTML = html;

      container.querySelectorAll('details').forEach(det => {
        det.addEventListener('toggle', () => requestAnimationFrame(drawSvgConnectors));
      });

      observeFlowchartLayoutChanges();
      renderOutlineList();
      scheduleConnectorRedraw();
    }

    let flowchartResizeObserver = null;
    let connectorRafId = null;

    function scheduleConnectorRedraw() {
      if (connectorRafId) cancelAnimationFrame(connectorRafId);
      connectorRafId = requestAnimationFrame(() => {
        connectorRafId = null;
        drawSvgConnectors();
      });
      setTimeout(drawSvgConnectors, 60);
      setTimeout(drawSvgConnectors, 220);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          requestAnimationFrame(drawSvgConnectors);
        });
      }
    }

    function observeFlowchartLayoutChanges() {
      if (typeof ResizeObserver === 'undefined') return;
      if (!flowchartResizeObserver) {
        flowchartResizeObserver = new ResizeObserver(() => {
          if (connectorRafId) cancelAnimationFrame(connectorRafId);
          connectorRafId = requestAnimationFrame(() => {
            connectorRafId = null;
            drawSvgConnectors();
          });
        });
      }
      flowchartResizeObserver.disconnect();
      const viewport = document.getElementById('flowchart-viewport');
      if (viewport) flowchartResizeObserver.observe(viewport);
      document.querySelectorAll('.flow-row__primary, .cf-intro-card, .decision-gate, .branch-row').forEach(el => {
        flowchartResizeObserver.observe(el);
      });
    }

    function drawSvgConnectors() {
      const svg = document.getElementById('flowchart-svg');
      const viewport = document.getElementById('flowchart-viewport');
      if (!svg || !viewport) return;

      const initialVpRect = viewport.getBoundingClientRect();
      if (initialVpRect.width === 0 || initialVpRect.height === 0) return;

      const defs = svg.querySelector('defs');
      svg.innerHTML = '';
      if (defs) svg.appendChild(defs);

      const scale = state.zoom || 1;

      // Dynamically align side items (Pass/Stop eligibility cards and conditional page cards) with their trigger question chip
      document.querySelectorAll('.flow-side-item').forEach(el => {
        el.style.marginTop = '0px';
      });
      document.querySelectorAll('.flow-step-row').forEach(row => {
        const sideItems = row.querySelectorAll(':scope > .flow-row__side > .flow-side-item');
        sideItems.forEach(item => {
          const qId = item.getAttribute('data-trigger-q-id');
          if (!qId) return;
          const qChip = row.querySelector(`.flow-row__primary .question-chip[data-question-id="${CSS.escape(String(qId))}"]`);
          if (!qChip) return;
          const qRect = qChip.getBoundingClientRect();
          const itemRect = item.getBoundingClientRect();
          const diffY = (qRect.top - itemRect.top) / scale;
          if (diffY > 4) {
            item.style.marginTop = `${Math.round(diffY)}px`;
          }
        });
      });

      // Force synchronous layout flush after marginTop adjustments before reading coordinates
      void viewport.offsetHeight;

      const vpRect = viewport.getBoundingClientRect();
      const svgW = Math.max(Math.ceil(viewport.scrollWidth), Math.ceil(vpRect.width / scale));
      const svgH = Math.max(Math.ceil(viewport.scrollHeight), Math.ceil(vpRect.height / scale));
      svg.setAttribute('width', String(svgW));
      svg.setAttribute('height', String(svgH));

      function getCoords(el) {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const left = (r.left - vpRect.left) / scale;
        const top = (r.top - vpRect.top) / scale;
        const width = r.width / scale;
        const height = r.height / scale;
        return {
          left,
          top,
          right: left + width,
          bottom: top + height,
          width,
          height,
          topCenter: { x: left + width / 2, y: top },
          bottomCenter: { x: left + width / 2, y: top + height },
          leftCenter: { x: left, y: top + height / 2 },
          rightCenter: { x: left + width, y: top + height / 2 }
        };
      }

      function applyEdgeStyle(path, edgeType) {
        if (edgeType === 'active') {
          path.setAttribute('class', 'flow-edge flow-edge--active');
          path.setAttribute('marker-end', 'url(#arrow-active)');
        } else if (edgeType === 'stop' || edgeType === 'stop-active') {
          path.setAttribute('class', edgeType === 'stop-active' ? 'flow-edge flow-edge--stop-active' : 'flow-edge flow-edge--stop');
          path.setAttribute('marker-end', 'url(#arrow-stop)');
        } else if (edgeType === 'loop') {
          path.setAttribute('class', 'flow-edge flow-edge--loop');
          path.setAttribute('marker-end', 'url(#arrow-loop)');
        } else if (edgeType === 'conditional' || edgeType === 'conditional-active') {
          path.setAttribute('class', edgeType === 'conditional-active' ? 'flow-edge flow-edge--conditional-active' : 'flow-edge flow-edge--conditional');
          path.setAttribute('marker-start', 'url(#dot-conditional)');
          path.setAttribute('marker-end', 'url(#arrow-conditional)');
        } else if (edgeType === 'hidden') {
          path.setAttribute('class', 'flow-edge flow-edge--hidden');
          path.setAttribute('marker-end', 'url(#arrow-hidden)');
        } else {
          path.setAttribute('class', 'flow-edge flow-edge--default');
          path.setAttribute('marker-end', 'url(#arrow-default)');
        }
      }

      function appendCurve(p1, p2, edgeType = 'default') {
        if (!p1 || !p2) return;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const dy = Math.max(20, Math.abs(p2.y - p1.y) * 0.5);
        const d = `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + dy}, ${p2.x} ${p2.y - dy}, ${p2.x} ${p2.y}`;
        path.setAttribute('d', d);
        applyEdgeStyle(path, edgeType);
        svg.appendChild(path);
      }

      function appendHorizontalCurve(p1, p2, edgeType = 'default') {
        if (!p1 || !p2) return;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const dx = Math.max(34, Math.abs(p2.x - p1.x) * 0.55);
        const d = `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
        path.setAttribute('d', d);
        applyEdgeStyle(path, edgeType);
        svg.appendChild(path);
      }

      function drawBlockEligibilityConnectors(bObj, screenCoords, isVisible, isBlocked) {
        if (!bObj.eligibilityDefinition || !screenCoords) return;
        const passEl = getCoords(document.getElementById(`elig-pass-node-${bObj.id}`));
        const stopEl = getCoords(document.getElementById(`elig-stop-node-${bObj.id}`));
        if (!passEl || !stopEl) return;

        const passes = !isBlocked && isVisible && doesBlockPassEligibilityInSim(bObj);
        const stops = !isBlocked && isVisible && state.simulationEnabled && !doesBlockPassEligibilityInSim(bObj);
        const passEdge = !state.simulationEnabled ? 'default' : (passes ? 'active' : 'hidden');
        const stopEdge = !state.simulationEnabled ? 'stop' : (stops ? 'stop-active' : 'hidden');

        const eligLeaves = collectLeafNodes(bObj.eligibilityDefinition?.predicate?.rootNode?.node);
        const eligQIds = Array.from(new Set(eligLeaves.map(l => l.questionId != null ? String(l.questionId) : null).filter(Boolean)));

        if (passEl.leftCenter.x > screenCoords.rightCenter.x + 10) {
          // Side-by-side layout: connect from eligibility question chip(s) on the left to Pass / Stop cards on the right
          let connectedFromQuestion = false;
          eligQIds.forEach(qId => {
            const qDom = document.getElementById(`flow-node-question-${bObj.id}-${qId}`);
            const qCoords = getCoords(qDom);
            if (qCoords) {
              connectedFromQuestion = true;
              appendHorizontalCurve(qCoords.rightCenter, passEl.leftCenter, passEdge);
              appendHorizontalCurve(qCoords.rightCenter, stopEl.leftCenter, stopEdge);
            }
          });
          if (!connectedFromQuestion) {
            appendHorizontalCurve(screenCoords.rightCenter, passEl.leftCenter, passEdge);
            appendHorizontalCurve(screenCoords.rightCenter, stopEl.leftCenter, stopEdge);
          }
        } else {
          // Stacked fallback (e.g. narrow screens or inside a parallel branch column)
          appendCurve(screenCoords.bottomCenter, passEl.topCenter, passEdge);
          appendCurve(screenCoords.bottomCenter, stopEl.topCenter, stopEdge);
        }
      }

      const startEl = getCoords(document.getElementById('flow-node-start'));
      const endEl = getCoords(document.getElementById('flow-node-end'));
      const blocks = state.formData.program?.blockDefinitions || [];
      if (!startEl || !endEl) return;

      const questionsMap = getQuestionsMap();
      const classification = classifyProgramBlocks(blocks, questionsMap);

      let prevAnchors = [];
      let prevEdges = [];
      const topSpineEdge = state.simulationEnabled ? 'active' : 'default';

      ['flow-node-intro-description', 'flow-node-intro-steps', 'flow-node-start'].forEach(spineId => {
        const spineEl = getCoords(document.getElementById(spineId));
        if (spineEl) {
          prevAnchors.forEach((anc, aIdx) => {
            appendCurve(anc, spineEl.topCenter, prevEdges[aIdx] || topSpineEdge);
          });
          prevAnchors = [spineEl.bottomCenter];
          prevEdges = [topSpineEdge];
        }
      });

      let blockedSoFar = false;
      let i = 0;

      while (i < blocks.length) {
        const block = blocks[i];

        if (classification.sideConditionalBlockIds.has(block.id)) {
          i++;
          continue;
        }

        // True Parallel Visibility Branch Group
        if (classification.parallelGroupsByFirstBlockId.has(block.id)) {
          const branchGroup = classification.parallelGroupsByFirstBlockId.get(block.id);
          const gateEl = getCoords(document.getElementById(`flow-node-gate-${block.id}`));
          if (gateEl) {
            prevAnchors.forEach((anc, aIdx) => {
              appendCurve(anc, gateEl.topCenter, prevEdges[aIdx] || 'default');
            });

            const nextAnchors = [];
            const nextEdges = [];

            branchGroup.forEach(bBlock => {
              const bScreenEl = getCoords(document.getElementById(`flow-node-screen-${bBlock.id}`));
              if (!bScreenEl) return;

              const isBVisible = isBlockVisibleInSim(bBlock);
              const bEdge = blockedSoFar ? 'hidden' : (!isBVisible && state.simulationEnabled ? 'hidden' : (state.simulationEnabled ? 'active' : 'default'));

              appendCurve(gateEl.bottomCenter, bScreenEl.topCenter, bEdge);

              if (bBlock.eligibilityDefinition) {
                drawBlockEligibilityConnectors(bBlock, bScreenEl, isBVisible, blockedSoFar);
                const passEl = getCoords(document.getElementById(`elig-pass-node-${bBlock.id}`));
                const passes = !blockedSoFar && isBVisible && doesBlockPassEligibilityInSim(bBlock);
                if (passEl && passEl.leftCenter.x <= bScreenEl.rightCenter.x + 10) {
                  nextAnchors.push(passEl.bottomCenter);
                  nextEdges.push(!state.simulationEnabled ? 'default' : (passes ? 'active' : 'hidden'));
                } else {
                  nextAnchors.push(bScreenEl.bottomCenter);
                  nextEdges.push(!state.simulationEnabled ? 'default' : (passes ? 'active' : 'hidden'));
                }
              } else {
                nextAnchors.push(bScreenEl.bottomCenter);
                nextEdges.push(bEdge);
              }
            });

            prevAnchors = nextAnchors;
            prevEdges = nextEdges;
          }

          i += branchGroup.length;
          continue;
        }

        // Primary screen node on the left spine
        const screenEl = getCoords(document.getElementById(`flow-node-screen-${block.id}`));
        if (screenEl) {
          const isVisible = isBlockVisibleInSim(block);
          const edge = blockedSoFar ? 'hidden' : (!isVisible && state.simulationEnabled ? 'hidden' : (block.repeaterId ? 'loop' : (state.simulationEnabled ? 'active' : 'default')));

          prevAnchors.forEach((anc, aIdx) => {
            appendCurve(anc, screenEl.topCenter, prevEdges[aIdx] || edge);
          });

          if (block.eligibilityDefinition) {
            drawBlockEligibilityConnectors(block, screenEl, isVisible, blockedSoFar);
            const passes = !blockedSoFar && isVisible && doesBlockPassEligibilityInSim(block);
            if (!passes && state.simulationEnabled && state.formData.program?.eligibilityIsGating !== false) {
              blockedSoFar = true;
            }
          }

          const outEdge = blockedSoFar ? 'hidden' : edge;
          prevAnchors = [screenEl.bottomCenter];
          prevEdges = [outEdge];
        }

        i++;
      }

      prevAnchors.forEach((anc, aIdx) => {
        appendCurve(anc, endEl.topCenter, prevEdges[aIdx] || (blockedSoFar ? 'hidden' : 'default'));
      });

      // Draw dark gold dotted connectors from trigger questions to side conditional screens
      blocks.forEach(condBlock => {
        if (!classification.sideConditionalBlockIds.has(condBlock.id)) return;
        const condEl = getCoords(document.getElementById(`flow-node-screen-${condBlock.id}`));
        if (!condEl) return;

        const isCondVisible = isBlockVisibleInSim(condBlock);
        const condEdgeType = !state.simulationEnabled
          ? 'conditional'
          : (isCondVisible ? 'conditional-active' : 'hidden');

        const condLeaves = collectLeafNodes((condBlock.hidePredicate || condBlock.optionalPredicate)?.rootNode?.node);
        const triggerQIds = Array.from(new Set(condLeaves.map(l => l.questionId != null ? String(l.questionId) : null).filter(Boolean)));

        triggerQIds.forEach((qId, qIdx) => {
          const qDom = document.querySelector(`.question-chip[data-question-id="${CSS.escape(String(qId))}"]`);
          const qCoords = getCoords(qDom);
          if (!qCoords) return;

          const targetY = Math.min(condEl.bottom - 16, condEl.top + 36 + qIdx * 18);

          if (condEl.left > qCoords.right + 10) {
            appendHorizontalCurve(qCoords.rightCenter, { x: condEl.left, y: targetY }, condEdgeType);
          } else if (Math.abs(condEl.left - qCoords.left) < 40) {
            // Chained conditional page in the same right column: curve around the right side
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const p1 = qCoords.rightCenter;
            const p2 = { x: condEl.right, y: targetY };
            const d = `M ${p1.x} ${p1.y} C ${p1.x + 44} ${p1.y}, ${p2.x + 44} ${p2.y}, ${p2.x} ${p2.y}`;
            path.setAttribute('d', d);
            applyEdgeStyle(path, condEdgeType);
            svg.appendChild(path);
          } else {
            appendCurve(qCoords.bottomCenter, condEl.topCenter, condEdgeType);
          }
        });

        if (condBlock.eligibilityDefinition) {
          drawBlockEligibilityConnectors(condBlock, condEl, isCondVisible, false);
        }
      });
    }

    function updateStickyOffsets() {
      const simBar = document.querySelector('.simulator-bar');
      const h = simBar ? simBar.getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty('--sim-bar-offset', `${h}px`);
    }

    

    function initVisualizerControls() {
      initOutlineToggle();

      const localeSelect = document.getElementById('locale-select');
      if (localeSelect) {
        localeSelect.addEventListener('change', (e) => {
          state.locale = e.target.value;
          renderProgramHeader();
          renderFlowchart();
        });
      }

      window.addEventListener('resize', () => {
        const step3View = document.getElementById('step-view-3');
        if (step3View && !step3View.hidden) {
          updateStickyOffsets();
          requestAnimationFrame(drawSvgConnectors);
        }
      });
    }

    function renderVisualizerWithProgram(wrapper) {
      state.formData = wrapper;
      state.simulationEnabled = false;

      discoverLocales();
      renderProgramHeader();
      renderJourneyTrail();
      renderFlowchart();
      updateStickyOffsets();
      requestAnimationFrame(drawSvgConnectors);
      setTimeout(drawSvgConnectors, 80);
      setTimeout(drawSvgConnectors, 250);
    }


  const CiviFormVisualizer = {
    mount(containerEl) {
      return ensureMounted(containerEl);
    },
    render(programWrapper) {
      if (!ensureMounted()) return;
      renderVisualizerWithProgram(programWrapper);
    },
    refreshLayout() {
      if (!isMounted) return;
      updateStickyOffsets();
      requestAnimationFrame(drawSvgConnectors);
    }
  };

  global.CiviFormVisualizer = CiviFormVisualizer;
  global.initVisualizerControls = () => ensureMounted();
  global.scrollToScreenNode = scrollToScreenNode;
  global.renderVisualizerWithProgram = (wrapper) => CiviFormVisualizer.render(wrapper);
  global.drawSvgConnectors = () => CiviFormVisualizer.refreshLayout();
  global.updateStickyOffsets = () => {
    if (isMounted) updateStickyOffsets();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => ensureMounted());
  } else {
    ensureMounted();
  }
})(window);
