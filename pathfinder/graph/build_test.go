package graph

import (
	"encoding/json"
	"testing"
)

const sampleFC = `{
  "type": "FeatureCollection",
  "features": [
    {"type": "Feature", "properties": {"kind": "node"}, "geometry": {"type": "Point", "coordinates": [0, 0]}},
    {"type": "Feature", "properties": {"kind": "node"}, "geometry": {"type": "Point", "coordinates": [10, 0]}},
    {"type": "Feature", "properties": {"kind": "link"}, "geometry": {"type": "LineString", "coordinates": [[0, 0], [5, 1], [10, 0]]}},
    {"type": "Feature", "properties": {"kind": "block"}, "geometry": {"type": "Polygon", "coordinates": [[[1,1],[2,1],[2,2],[1,2],[1,1]]]}}
  ]
}`

func TestBuildGraphFromFeatureCollection(t *testing.T) {
	var fc FeatureCollection
	if err := json.Unmarshal([]byte(sampleFC), &fc); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	g, err := BuildGraph(&fc)
	if err != nil {
		t.Fatalf("BuildGraph error: %v", err)
	}

	if len(g.Nodes) != 2 {
		t.Errorf("node count = %d, want 2 (polygon must be ignored)", len(g.Nodes))
	}
	if len(g.Edges()) != 1 {
		t.Fatalf("edge count = %d, want 1", len(g.Edges()))
	}
	edge := g.Edges()[0]
	if len(edge.Polyline) != 3 {
		t.Errorf("edge polyline points = %d, want 3 (shape point preserved)", len(edge.Polyline))
	}

	res, err := ShortestPath(g, edge.From, edge.To, Dijkstra)
	if err != nil {
		t.Fatalf("ShortestPath error: %v", err)
	}
	if res.Distance <= 10 {
		t.Errorf("distance = %v, want > 10 (path bends through the shape point)", res.Distance)
	}
}

func TestExtractBlocksReturnsOuterRing(t *testing.T) {
	var fc FeatureCollection
	if err := json.Unmarshal([]byte(sampleFC), &fc); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	blocks, err := ExtractBlocks(&fc)
	if err != nil {
		t.Fatalf("ExtractBlocks error: %v", err)
	}
	if len(blocks) != 1 {
		t.Fatalf("block count = %d, want 1", len(blocks))
	}
	if len(blocks[0]) != 5 {
		t.Errorf("ring point count = %d, want 5 (closed square)", len(blocks[0]))
	}
}

// Regression test: a single LineString drawn through several existing node
// points (as the editor's snapping allows) must split into one edge per
// junction, not collapse into a single start->end edge that strands the
// in-between nodes with no connectivity at all.
func TestBuildGraphSplitsLinkAtInteriorNodes(t *testing.T) {
	fcJSON := `{
    "type": "FeatureCollection",
    "features": [
      {"type": "Feature", "properties": {"kind": "node"}, "geometry": {"type": "Point", "coordinates": [0, 0]}},
      {"type": "Feature", "properties": {"kind": "node"}, "geometry": {"type": "Point", "coordinates": [5, 0]}},
      {"type": "Feature", "properties": {"kind": "node"}, "geometry": {"type": "Point", "coordinates": [10, 0]}},
      {"type": "Feature", "properties": {"kind": "link"}, "geometry": {"type": "LineString", "coordinates": [[0, 0], [5, 0], [10, 0]]}}
    ]
  }`
	var fc FeatureCollection
	if err := json.Unmarshal([]byte(fcJSON), &fc); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	g, err := BuildGraph(&fc)
	if err != nil {
		t.Fatalf("BuildGraph error: %v", err)
	}

	if len(g.Nodes) != 3 {
		t.Fatalf("node count = %d, want 3", len(g.Nodes))
	}
	if len(g.Edges()) != 2 {
		t.Fatalf("edge count = %d, want 2 (split at the middle node)", len(g.Edges()))
	}

	// the middle node must now be reachable — this used to fail with
	// ErrNoPath because it was stranded with zero edges.
	res, err := ShortestPath(g, "node-0", "node-1", Dijkstra)
	if err != nil {
		t.Fatalf("ShortestPath to interior node failed: %v", err)
	}
	if res.Distance != 5 {
		t.Errorf("distance node-0->node-1 = %v, want 5", res.Distance)
	}

	res2, err := ShortestPath(g, "node-0", "node-2", Dijkstra)
	if err != nil {
		t.Fatalf("ShortestPath end-to-end failed: %v", err)
	}
	if res2.Distance != 10 {
		t.Errorf("distance node-0->node-2 = %v, want 10", res2.Distance)
	}
}

func TestBuildGraphLinkWithoutExplicitNodesCreatesEndpoints(t *testing.T) {
	fcJSON := `{
    "type": "FeatureCollection",
    "features": [
      {"type": "Feature", "properties": {"kind": "link"}, "geometry": {"type": "LineString", "coordinates": [[0, 0], [10, 0]]}}
    ]
  }`
	var fc FeatureCollection
	if err := json.Unmarshal([]byte(fcJSON), &fc); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	g, err := BuildGraph(&fc)
	if err != nil {
		t.Fatalf("BuildGraph error: %v", err)
	}
	if len(g.Nodes) != 2 {
		t.Errorf("node count = %d, want 2 (implicit endpoints)", len(g.Nodes))
	}
	if len(g.Edges()) != 1 {
		t.Errorf("edge count = %d, want 1", len(g.Edges()))
	}
}
