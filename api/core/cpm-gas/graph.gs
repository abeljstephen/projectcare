// cpm/graph.gs — Graph construction and validation for CP Engine
// Project Advisor — CP Engine v1.0
// Pure GAS global scope. No Node.js.

var CPM_DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];

// ─────────────────────────────────────────────
// Task ID helper (consistent across all modules)
// ─────────────────────────────────────────────
function cpmTaskId(task, idx) {
  return String(task.id || task.task || ('task_' + idx));
}

// ─────────────────────────────────────────────
// Build directed graph from task list
// ─────────────────────────────────────────────
function cpmBuildGraph(tasks) {
  const nodes      = {};   // id → { id, name, index }
  const edges      = [];   // { from, to, type, lag }
  const adjacency  = {};   // id → [{to, type, lag}]  (successors)
  const reverseAdj = {};   // id → [{from, type, lag}] (predecessors)

  // Register nodes
  tasks.forEach(function(task, idx) {
    const id = cpmTaskId(task, idx);
    nodes[id]      = { id: id, name: task.task || task.name || id, index: idx };
    adjacency[id]  = [];
    reverseAdj[id] = [];
  });

  // Register edges
  tasks.forEach(function(task, idx) {
    const toId = cpmTaskId(task, idx);
    const preds = task.predecessors;
    if (!Array.isArray(preds) || preds.length === 0) return;

    preds.forEach(function(pred) {
      var fromId, type, lag;
      if (typeof pred === 'string' || typeof pred === 'number') {
        fromId = String(pred);
        type   = 'FS';
        lag    = 0;
      } else {
        fromId = String(pred.id || pred.task || '');
        type   = CPM_DEP_TYPES.indexOf(pred.type) >= 0 ? pred.type : 'FS';
        lag    = Number.isFinite(Number(pred.lag)) ? Number(pred.lag) : 0;
      }
      if (!nodes[fromId]) return; // non-existent predecessor — caught by validation
      if (fromId === toId) return;  // self-reference — caught by validation, skip edge

      const edge = { from: fromId, to: toId, type: type, lag: lag };
      edges.push(edge);
      adjacency[fromId].push({ to: toId, type: type, lag: lag });
      reverseAdj[toId].push({ from: fromId, type: type, lag: lag });
    });
  });

  const sources = Object.keys(nodes).filter(function(id) { return reverseAdj[id].length === 0; });
  const sinks   = Object.keys(nodes).filter(function(id) { return adjacency[id].length === 0;  });

  return { nodes: nodes, edges: edges, adjacency: adjacency, reverseAdj: reverseAdj, sources: sources, sinks: sinks };
}

// ─────────────────────────────────────────────
// Input validation (before any algorithm runs)
// ─────────────────────────────────────────────
function cpmValidateGraph(tasks, graph) {
  const errors  = [];
  const taskIds = {};
  Object.keys(graph.nodes).forEach(function(id) { taskIds[id] = true; });

  tasks.forEach(function(task, idx) {
    const id    = cpmTaskId(task, idx);
    const preds = task.predecessors;
    if (!Array.isArray(preds)) return;

    const seen = {};
    preds.forEach(function(pred) {
      var fromId, type;
      if (typeof pred === 'string' || typeof pred === 'number') {
        fromId = String(pred); type = 'FS';
      } else {
        fromId = String(pred.id || pred.task || '');
        type   = pred.type || 'FS';
      }

      if (fromId === id) {
        errors.push({ taskId: id, code: 'SELF_REFERENCE',
          message: 'Task "' + id + '" lists itself as a predecessor.' });
        return;
      }
      if (!taskIds[fromId]) {
        errors.push({ taskId: id, code: 'MISSING_PREDECESSOR',
          message: 'Task "' + id + '" references non-existent predecessor "' + fromId + '".' });
        return;
      }
      const key = fromId + '|' + type;
      if (seen[key]) {
        errors.push({ taskId: id, code: 'DUPLICATE_PREDECESSOR',
          message: 'Task "' + id + '" has duplicate predecessor "' + fromId + '" (type ' + type + ').' });
      }
      seen[key] = true;
    });
  });

  return { valid: errors.length === 0, errors: errors };
}

// ─────────────────────────────────────────────
// Tarjan's SCC — detect ALL cycles in one pass
// Returns array of cycles (each cycle = array of node IDs).
// Empty array = no cycles (graph is a valid DAG).
// ─────────────────────────────────────────────
function cpmDetectCycles(graph) {
  const nodeIds = Object.keys(graph.nodes);
  const index   = {};
  const lowlink = {};
  const onStack = {};
  const stack   = [];
  var   counter = 0;
  const sccs    = [];

  function strongConnect(v) {
    index[v]   = counter;
    lowlink[v] = counter;
    counter++;
    stack.push(v);
    onStack[v] = true;

    (graph.adjacency[v] || []).forEach(function(edge) {
      const w = edge.to;
      if (index[w] === undefined) {
        strongConnect(w);
        lowlink[v] = Math.min(lowlink[v], lowlink[w]);
      } else if (onStack[w]) {
        lowlink[v] = Math.min(lowlink[v], index[w]);
      }
    });

    if (lowlink[v] === index[v]) {
      const scc = [];
      var w;
      do {
        w = stack.pop();
        onStack[w] = false;
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) sccs.push(scc); // size > 1 = cycle
    }
  }

  nodeIds.forEach(function(v) {
    if (index[v] === undefined) strongConnect(v);
  });

  return sccs;
}

// ─────────────────────────────────────────────
// Kahn's topological sort (also detects cycle if sort fails)
// Returns { order: [id,...], success: bool }
// ─────────────────────────────────────────────
function cpmTopologicalSort(graph) {
  const nodes    = Object.keys(graph.nodes);
  const inDegree = {};
  nodes.forEach(function(id) { inDegree[id] = 0; });
  graph.edges.forEach(function(e) { inDegree[e.to]++; });

  const queue = nodes.filter(function(id) { return inDegree[id] === 0; });
  const order = [];

  while (queue.length > 0) {
    const v = queue.shift();
    order.push(v);
    (graph.adjacency[v] || []).forEach(function(edge) {
      inDegree[edge.to]--;
      if (inDegree[edge.to] === 0) queue.push(edge.to);
    });
  }

  return { order: order, success: order.length === nodes.length };
}

// ─────────────────────────────────────────────
// All-pairs shortest path in the DAG (BFS from each source).
// Returns dist[srcId][destId] = number of hops, or Infinity if unreachable.
// Used by stochastic-cpm correlation matrix builder.
// ─────────────────────────────────────────────
function cpmAllPairsDistance(graph, order) {
  var nodeIds = order || Object.keys(graph.nodes);
  var dist = {};

  nodeIds.forEach(function(src) {
    dist[src] = {};
    var visited = {};
    var queue = [{ id: src, d: 0 }];
    visited[src] = true;
    while (queue.length > 0) {
      var item = queue.shift();
      dist[src][item.id] = item.d;
      (graph.adjacency[item.id] || []).forEach(function(e) {
        if (!visited[e.to]) {
          visited[e.to] = true;
          queue.push({ id: e.to, d: item.d + 1 });
        }
      });
    }
    nodeIds.forEach(function(id) {
      if (dist[src][id] === undefined) dist[src][id] = Infinity;
    });
  });

  return dist;
}

// ─────────────────────────────────────────────
// For each merge node (in-degree > 1), compute the set of all ancestors
// (nodes that have any directed path leading to this node).
// Returns { mergeNodeId: { ancestorId: true, ... }, ... }
// Used to identify shared ancestry between tasks feeding the same convergence point.
// ─────────────────────────────────────────────
function cpmMergeAncestors(graph, order) {
  var nodeIds = order || Object.keys(graph.nodes);
  var mergeAncestors = {};

  nodeIds.forEach(function(id) {
    if ((graph.reverseAdj[id] || []).length > 1) {
      var ancestors = {};
      var queue = [id];
      var visited = {};
      visited[id] = true;
      while (queue.length > 0) {
        var v = queue.shift();
        (graph.reverseAdj[v] || []).forEach(function(e) {
          if (!visited[e.from]) {
            visited[e.from] = true;
            ancestors[e.from] = true;
            queue.push(e.from);
          }
        });
      }
      mergeAncestors[id] = ancestors;
    }
  });

  return mergeAncestors;
}

// ─────────────────────────────────────────────
// Find disconnected task groups (orphan detection)
// Returns array of arrays — each inner array is a disconnected component.
// The main (largest) component is excluded; all others are returned as orphan groups.
// ─────────────────────────────────────────────
function cpmFindOrphans(graph) {
  const nodes   = Object.keys(graph.nodes);
  if (nodes.length === 0) return [];

  // If no edges exist at all, this is a "no dependencies defined" state, not an orphan
  // condition. Every task would be its own component, producing n-1 spurious warnings.
  // Only report orphans when there are edges AND some tasks are unreachable.
  if (graph.edges.length === 0) return [];

  const visited    = {};
  const components = [];

  nodes.forEach(function(startId) {
    if (visited[startId]) return;
    const component = [];
    const queue     = [startId];
    visited[startId] = true;

    while (queue.length > 0) {
      const v = queue.shift();
      component.push(v);
      var neighbors = (graph.adjacency[v]  || []).map(function(e) { return e.to;   })
        .concat((graph.reverseAdj[v] || []).map(function(e) { return e.from; }));
      neighbors.forEach(function(w) {
        if (!visited[w]) { visited[w] = true; queue.push(w); }
      });
    }
    components.push(component);
  });

  if (components.length <= 1) return [];
  components.sort(function(a, b) { return b.length - a.length; });
  return components.slice(1);
}
