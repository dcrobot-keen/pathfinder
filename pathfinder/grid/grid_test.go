package grid

import "testing"

func TestRasterizeBlocksMarksInteriorCells(t *testing.T) {
	g := NewGrid(0, 0, 1, 10, 10)
	square := []Point{{X: 2, Y: 2}, {X: 5, Y: 2}, {X: 5, Y: 5}, {X: 2, Y: 5}, {X: 2, Y: 2}}
	g.RasterizeBlocks([][]Point{square})

	if !g.IsOccupiedPoint(Point{X: 3.5, Y: 3.5}) {
		t.Error("center of the block should be occupied")
	}
	if g.IsOccupiedPoint(Point{X: 0.5, Y: 0.5}) {
		t.Error("point far outside the block should be free")
	}
	if g.IsOccupiedPoint(Point{X: 8.5, Y: 8.5}) {
		t.Error("point outside the block should be free")
	}
}

func TestIsOccupiedCellOutOfBoundsIsTreatedAsBlocked(t *testing.T) {
	g := NewGrid(0, 0, 1, 5, 5)
	if !g.IsOccupiedCell(-1, 0) {
		t.Error("out-of-bounds cell should be treated as occupied")
	}
	if !g.IsOccupiedCell(5, 5) {
		t.Error("out-of-bounds cell should be treated as occupied")
	}
}

func TestBoundsCoversAllPointsWithPadding(t *testing.T) {
	pts := []Point{{X: 1, Y: 1}, {X: 9, Y: 4}}
	originX, originY, cols, rows := Bounds(pts, 1, 1)
	if originX != 0 || originY != 0 {
		t.Errorf("origin = (%v, %v), want (0, 0)", originX, originY)
	}
	// width = (9-1)+2*1=10 -> cols=11 with the +1 cell used by NewGrid's int() truncation
	if cols < 10 || rows < 4 {
		t.Errorf("cols/rows = %d/%d, want at least 10/4", cols, rows)
	}
}
