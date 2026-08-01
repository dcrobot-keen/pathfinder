package grid

import "testing"

func TestHybridAStarOpenSpace(t *testing.T) {
	g := NewGrid(0, 0, 0.25, 40, 40)
	res, err := HybridAStar(g, Point{X: 1, Y: 1}, Point{X: 8, Y: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Path) < 2 {
		t.Fatal("expected a multi-point path")
	}
	if len(res.Path) != len(res.Headings) {
		t.Fatalf("path/headings length mismatch: %d vs %d", len(res.Path), len(res.Headings))
	}
	straightLine := dist(Point{X: 1, Y: 1}, Point{X: 8, Y: 1})
	if res.Distance < straightLine {
		t.Errorf("distance %v shorter than straight line %v", res.Distance, straightLine)
	}
	if res.Distance > straightLine*1.5 {
		t.Errorf("distance %v much longer than straight line %v in open space", res.Distance, straightLine)
	}
	last := res.Path[len(res.Path)-1]
	if dist(last, Point{X: 8, Y: 1}) > 1e-9 {
		t.Errorf("path should end exactly at the goal, got %+v", last)
	}
}

func TestHybridAStarAvoidsObstacle(t *testing.T) {
	g := NewGrid(0, 0, 0.25, 40, 20)
	wall := []Point{{X: 4, Y: 0}, {X: 5, Y: 0}, {X: 5, Y: 3.5}, {X: 4, Y: 3.5}, {X: 4, Y: 0}}
	g.RasterizeBlocks([][]Point{wall})

	res, err := HybridAStar(g, Point{X: 1, Y: 1}, Point{X: 8, Y: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, p := range res.Path {
		if g.IsOccupiedPoint(p) {
			t.Fatalf("path point %+v falls inside the obstacle", p)
		}
	}
}

func TestHybridAStarNoPathWhenGoalEnclosed(t *testing.T) {
	g := NewGrid(0, 0, 0.25, 40, 40)
	box := [][]Point{
		{{X: 3, Y: 3}, {X: 7, Y: 3}, {X: 7, Y: 3.5}, {X: 3, Y: 3.5}, {X: 3, Y: 3}},
		{{X: 3, Y: 7}, {X: 7, Y: 7}, {X: 7, Y: 7.5}, {X: 3, Y: 7.5}, {X: 3, Y: 7}},
		{{X: 3, Y: 3}, {X: 3.5, Y: 3}, {X: 3.5, Y: 7.5}, {X: 3, Y: 7.5}, {X: 3, Y: 3}},
		{{X: 6.5, Y: 3}, {X: 7, Y: 3}, {X: 7, Y: 7.5}, {X: 6.5, Y: 7.5}, {X: 6.5, Y: 3}},
	}
	g.RasterizeBlocks(box)

	_, err := HybridAStar(g, Point{X: 1, Y: 1}, Point{X: 5, Y: 5})
	if err == nil {
		t.Fatal("expected no-path error when goal is fully enclosed")
	}
}

func TestHybridAStarStartInsideObstacleErrors(t *testing.T) {
	g := NewGrid(0, 0, 0.25, 20, 20)
	g.RasterizeBlocks([][]Point{{{X: 0, Y: 0}, {X: 5, Y: 0}, {X: 5, Y: 5}, {X: 0, Y: 5}, {X: 0, Y: 0}}})
	_, err := HybridAStar(g, Point{X: 2, Y: 2}, Point{X: 8, Y: 8})
	if err == nil {
		t.Fatal("expected error when start point is inside an obstacle")
	}
}
