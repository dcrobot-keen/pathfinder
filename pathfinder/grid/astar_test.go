package grid

import "testing"

func TestGridAStarOpenSpace(t *testing.T) {
	g := NewGrid(0, 0, 1, 20, 20)
	res, err := GridAStar(g, Point{X: 1, Y: 1}, Point{X: 15, Y: 1})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Distance > 15 {
		t.Errorf("distance = %v, want ~14 in open space", res.Distance)
	}
	if len(res.Path) < 2 {
		t.Fatal("path should have at least start and end points")
	}
}

func TestGridAStarRoutesAroundWall(t *testing.T) {
	g := NewGrid(0, 0, 1, 20, 20)
	// vertical wall from y=0..14 at x=10, leaving a gap at the top (y=15..19)
	wall := make([][]Point, 0)
	wall = append(wall, []Point{{X: 9, Y: 0}, {X: 11, Y: 0}, {X: 11, Y: 14}, {X: 9, Y: 14}, {X: 9, Y: 0}})
	g.RasterizeBlocks(wall)

	res, err := GridAStar(g, Point{X: 2, Y: 2}, Point{X: 18, Y: 2})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, p := range res.Path {
		if g.IsOccupiedPoint(p) {
			t.Fatalf("path point %+v falls inside the wall", p)
		}
	}
	// must detour up and over, so it's meaningfully longer than the 16m straight line
	if res.Distance < 16 {
		t.Errorf("distance = %v, expected a detour longer than the direct 16m line", res.Distance)
	}
}

func TestGridAStarNoPathWhenFullyEnclosed(t *testing.T) {
	g := NewGrid(0, 0, 1, 10, 10)
	ring := []Point{{X: 3, Y: 3}, {X: 7, Y: 3}, {X: 7, Y: 7}, {X: 3, Y: 7}, {X: 3, Y: 3}}
	// a solid box with the goal trapped inside it
	box := [][]Point{
		{{X: 2, Y: 2}, {X: 8, Y: 2}, {X: 8, Y: 3}, {X: 2, Y: 3}, {X: 2, Y: 2}}, // bottom wall
		{{X: 2, Y: 7}, {X: 8, Y: 7}, {X: 8, Y: 8}, {X: 2, Y: 8}, {X: 2, Y: 7}}, // top wall
		{{X: 2, Y: 2}, {X: 3, Y: 2}, {X: 3, Y: 8}, {X: 2, Y: 8}, {X: 2, Y: 2}}, // left wall
		{{X: 7, Y: 2}, {X: 8, Y: 2}, {X: 8, Y: 8}, {X: 7, Y: 8}, {X: 7, Y: 2}}, // right wall
	}
	g.RasterizeBlocks(box)
	_ = ring

	_, err := GridAStar(g, Point{X: 0.5, Y: 0.5}, Point{X: 5, Y: 5})
	if err == nil {
		t.Fatal("expected no-path error when goal is fully enclosed by obstacles")
	}
}

func TestGridAStarStartInsideObstacleErrors(t *testing.T) {
	g := NewGrid(0, 0, 1, 10, 10)
	g.RasterizeBlocks([][]Point{{{X: 0, Y: 0}, {X: 10, Y: 0}, {X: 10, Y: 10}, {X: 0, Y: 10}, {X: 0, Y: 0}}})
	_, err := GridAStar(g, Point{X: 5, Y: 5}, Point{X: 1, Y: 1})
	if err == nil {
		t.Fatal("expected error when start point is inside an obstacle")
	}
}
