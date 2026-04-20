// Ported from system-google-sheets-addon/core/visuals/sankey-flow.gs
// File: visuals/sankey-flow.gs
// Build a minimal Sankey dataset to show probability deltas through stages.
// Cleaned for pure Apps Script - global scope, no Node.js

/**
 * Build a minimal Sankey dataset to show probability deltas through stages.
 *
 * Nodes: Baseline → Adjusted → Optimized
 * Links carry positive values (percentage points); we clamp at 0 to avoid negatives.
 *
 * @param {Object} args
 * @param {number|null|undefined} args.pBase       // [0..1]
 * @param {number|null|undefined} args.pAdjusted   // [0..1]
 * @param {number|null|undefined} args.pOptimized  // [0..1]
 * @returns {{nodes:{name:string}[], links:{source:number,target:number,value:number}[]}}
 */
function buildSankeyFlow({ pBase, pAdjusted, pOptimized }) {
  const toPts = v => (Number.isFinite(v) ? v * 100 : null);

  const b = toPts(pBase);
  const a = toPts(pAdjusted);
  const o = toPts(pOptimized);

  const nodes = [{ name: 'Baseline' }, { name: 'Adjusted' }, { name: 'Optimized' }];

  // link values as positive deltas; if any stage missing, just skip that link
  const links = [];
  if (b != null && a != null) {
    links.push({ source: 0, target: 1, value: Math.max(0, a - b) });
  }
  if (a != null && o != null) {
    links.push({ source: 1, target: 2, value: Math.max(0, o - a) });
  } else if (b != null && o != null && (a == null)) {
    // If there is no explicit adjusted stage, connect Baseline → Optimized directly
    links.push({ source: 0, target: 2, value: Math.max(0, o - b) });
  }

  return { nodes, links };
}
