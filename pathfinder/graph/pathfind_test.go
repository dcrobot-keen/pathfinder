package graph

import (
	"math"
	"testing"
)

func line(a, b Point) []Point { return []Point{a, b} }

func TestDijkstraSimplePath(t *testing.T) {
	g := NewGraph()
	g.AddNode("a", Point{0, 0})
	g.AddNode("b", Point{1, 0})
	g.AddNode("c", Point{2, 0})
	g.AddEdge("ab", "a", "b", line(Point{0, 0}, Point{1, 0}))
	g.AddEdge("bc", "b", "c", line(Point{1, 0}, Point{2, 0}))

	res, err := ShortestPath(g, "a", "c", Dijkstra)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if math.Abs(res.Distance-2) > 1e-9 {
		t.Errorf("distance = %v, want 2", res.Distance)
	}
	wantSeq := []string{"a", "b", "c"}
	if len(res.NodeSequence) != len(wantSeq) {
		t.Fatalf("node sequence = %v, want %v", res.NodeSequence, wantSeq)
	}
	for i, id := range wantSeq {
		if res.NodeSequence[i] != id {
			t.Errorf("node sequence[%d] = %q, want %q", i, res.NodeSequence[i], id)
		}
	}
	if len(res.Path) != 3 {
		t.Errorf("path points = %d, want 3 (no duplicated shared vertex)", len(res.Path))
	}
}

// diamond: a-b-d (long way, weight 2*sqrt2) vs a-c-d (short way, weight 2)
func diamondGraph() *Graph {
	g := NewGraph()
	g.AddNode("a", Point{0, 0})
	g.AddNode("b", Point{1, 1})
	g.AddNode("c", Point{1, -1})
	g.AddNode("d", Point{2, 0})
	g.AddEdge("ab", "a", "b", line(Point{0, 0}, Point{1, 1}))
	g.AddEdge("bd", "b", "d", line(Point{1, 1}, Point{2, 0}))
	g.AddEdge("ac", "a", "c", line(Point{0, 0}, Point{1, -1}))
	g.AddEdge("cd", "c", "d", line(Point{1, -1}, Point{2, 0}))
	// both routes here are symmetric (equal length); add a shortcut so one
	// route is strictly shorter and there's a real "best" answer to assert.
	g.AddNode("e", Point{1, 0})
	g.AddEdge("ae", "a", "e", line(Point{0, 0}, Point{1, 0}))
	g.AddEdge("ed", "e", "d", line(Point{1, 0}, Point{2, 0}))
	return g
}

func TestShortestPathPrefersShorterRoute(t *testing.T) {
	g := diamondGraph()
	res, err := ShortestPath(g, "a", "d", Dijkstra)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if math.Abs(res.Distance-2) > 1e-9 {
		t.Errorf("distance = %v, want 2 (via shortcut node e)", res.Distance)
	}
	if res.NodeSequence[1] != "e" {
		t.Errorf("expected path to go through shortcut node e, got %v", res.NodeSequence)
	}
}

func TestAStarMatchesDijkstraCost(t *testing.T) {
	g := diamondGraph()
	dijkstraRes, err := ShortestPath(g, "a", "d", Dijkstra)
	if err != nil {
		t.Fatalf("dijkstra error: %v", err)
	}
	astarRes, err := ShortestPath(g, "a", "d", AStar)
	if err != nil {
		t.Fatalf("astar error: %v", err)
	}
	if math.Abs(dijkstraRes.Distance-astarRes.Distance) > 1e-9 {
		t.Errorf("A* distance %v != Dijkstra distance %v", astarRes.Distance, dijkstraRes.Distance)
	}
}

func TestNoPathWhenDisconnected(t *testing.T) {
	g := NewGraph()
	g.AddNode("a", Point{0, 0})
	g.AddNode("b", Point{1, 0})
	// no edge between them
	_, err := ShortestPath(g, "a", "b", Dijkstra)
	if err != ErrNoPath {
		t.Fatalf("err = %v, want ErrNoPath", err)
	}
}

func TestShortestPathUnknownNode(t *testing.T) {
	g := NewGraph()
	g.AddNode("a", Point{0, 0})
	if _, err := ShortestPath(g, "a", "missing", Dijkstra); err == nil {
		t.Fatal("expected error for unknown end node")
	}
	if _, err := ShortestPath(g, "missing", "a", Dijkstra); err == nil {
		t.Fatal("expected error for unknown start node")
	}
}
