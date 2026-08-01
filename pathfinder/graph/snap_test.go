package graph

import (
	"math"
	"testing"
)

func simpleGraph() *Graph {
	g := NewGraph()
	g.AddNode("a", Point{0, 0})
	g.AddNode("b", Point{10, 0})
	g.AddEdge("ab", "a", "b", line(Point{0, 0}, Point{10, 0}))
	return g
}

func TestSnapToExistingNode(t *testing.T) {
	g := simpleGraph()
	res, err := SnapToGraph(g, Point{0.01, 0.01})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.NodeID != "a" {
		t.Errorf("NodeID = %q, want %q", res.NodeID, "a")
	}
}

func TestSnapToEdgeInterior(t *testing.T) {
	g := simpleGraph()
	res, err := SnapToGraph(g, Point{5, 3})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.NodeID != "" {
		t.Fatalf("expected edge-interior snap, got NodeID = %q", res.NodeID)
	}
	if res.EdgeID != "ab" {
		t.Errorf("EdgeID = %q, want %q", res.EdgeID, "ab")
	}
	if math.Abs(res.Point.X-5) > 1e-9 || math.Abs(res.Point.Y) > 1e-9 {
		t.Errorf("snapped point = %+v, want {5 0}", res.Point)
	}
}

func TestSnapNearEdgeEndCollapsesToNode(t *testing.T) {
	g := simpleGraph()
	// projects to x=9.98 on the segment, well within NodeSnapEpsilon of node "b" (10,0)
	res, err := SnapToGraph(g, Point{9.98, 0})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.NodeID != "b" {
		t.Errorf("expected snap to collapse to node b, got %+v", res)
	}
}

func TestInsertVirtualNodeSplitsEdge(t *testing.T) {
	g := simpleGraph()
	snap, err := SnapToGraph(g, Point{5, 3})
	if err != nil {
		t.Fatalf("snap error: %v", err)
	}
	newID, err := g.InsertVirtualNode(snap, "virtual-1")
	if err != nil {
		t.Fatalf("insert error: %v", err)
	}
	if newID != "virtual-1" {
		t.Fatalf("newID = %q, want virtual-1", newID)
	}
	if _, ok := g.Nodes["virtual-1"]; !ok {
		t.Fatal("virtual-1 not registered as a node")
	}

	res, err := ShortestPath(g, "a", "virtual-1", Dijkstra)
	if err != nil {
		t.Fatalf("path to virtual node failed: %v", err)
	}
	if math.Abs(res.Distance-5) > 1e-9 {
		t.Errorf("distance a->virtual-1 = %v, want 5", res.Distance)
	}

	res2, err := ShortestPath(g, "virtual-1", "b", Dijkstra)
	if err != nil {
		t.Fatalf("path from virtual node failed: %v", err)
	}
	if math.Abs(res2.Distance-5) > 1e-9 {
		t.Errorf("distance virtual-1->b = %v, want 5", res2.Distance)
	}
}

func TestInsertVirtualNodeNoOpWhenAlreadyNode(t *testing.T) {
	g := simpleGraph()
	snap, err := SnapToGraph(g, Point{0, 0})
	if err != nil {
		t.Fatalf("snap error: %v", err)
	}
	id, err := g.InsertVirtualNode(snap, "should-not-be-used")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "a" {
		t.Errorf("id = %q, want existing node %q", id, "a")
	}
	if _, ok := g.Nodes["should-not-be-used"]; ok {
		t.Error("a redundant virtual node was created")
	}
}
