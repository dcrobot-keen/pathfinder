package main

import (
	"math"
	"testing"

	"pathfinder/graph"
)

func TestLocalSearchBoundsScalesWithDistance(t *testing.T) {
	start := graph.Point{X: 0, Y: 0}
	end := graph.Point{X: 100, Y: 0}
	minX, minY, maxX, maxY := localSearchBounds(start, end, 5.0)

	// padding = max(5, 100*0.6) = 60
	if math.Abs(minX-(-60)) > 1e-9 || math.Abs(maxX-160) > 1e-9 {
		t.Errorf("x bounds = [%v, %v], want [-60, 160]", minX, maxX)
	}
	if math.Abs(minY-(-60)) > 1e-9 || math.Abs(maxY-60) > 1e-9 {
		t.Errorf("y bounds = [%v, %v], want [-60, 60]", minY, maxY)
	}
}

func TestLocalSearchBoundsUsesMinPaddingWhenClose(t *testing.T) {
	start := graph.Point{X: 0, Y: 0}
	end := graph.Point{X: 1, Y: 0}
	minX, _, maxX, _ := localSearchBounds(start, end, 5.0)

	// padding = max(5, 1*0.6) = 5
	if math.Abs(minX-(-5)) > 1e-9 || math.Abs(maxX-6) > 1e-9 {
		t.Errorf("x bounds = [%v, %v], want [-5, 6]", minX, maxX)
	}
}

func TestLocalSearchBoundsStaysSmallRegardlessOfSiteSize(t *testing.T) {
	// 부지가 200x400m든 얼마든, start/end가 가까우면 검색 범위는 그와 무관하게 작아야 한다.
	start := graph.Point{X: 100, Y: 200}
	end := graph.Point{X: 102, Y: 201}
	minX, minY, maxX, maxY := localSearchBounds(start, end, 5.0)

	width := maxX - minX
	height := maxY - minY
	if width > 20 || height > 20 {
		t.Errorf("search bounds too large: %vx%v, want small regardless of a 200x400 site", width, height)
	}
}

func square(x0, y0, x1, y1 float64) []graph.Point {
	return []graph.Point{{X: x0, Y: y0}, {X: x1, Y: y0}, {X: x1, Y: y1}, {X: x0, Y: y1}}
}

func TestFilterRelevantBlocksDropsFarAwayObstacles(t *testing.T) {
	nearby := square(1, 1, 2, 2)
	farAway := square(300, 300, 301, 301) // 부지 반대편의 상관없는 장애물

	relevant := filterRelevantBlocks([][]graph.Point{nearby, farAway}, 0, 0, 10, 10)
	if len(relevant) != 1 {
		t.Fatalf("relevant block count = %d, want 1 (far-away one should be dropped)", len(relevant))
	}
	minX, _, _, _ := ringBounds(relevant[0])
	if minX != 1 {
		t.Errorf("kept the wrong block: %+v", relevant[0])
	}
}

func TestFilterRelevantBlocksKeepsPartiallyOverlapping(t *testing.T) {
	straddling := square(9, 9, 12, 12) // 검색 범위 경계에 걸친 장애물
	relevant := filterRelevantBlocks([][]graph.Point{straddling}, 0, 0, 10, 10)
	if len(relevant) != 1 {
		t.Fatalf("expected the straddling block to be kept, got %d blocks", len(relevant))
	}
}

func TestAdaptiveCellSizeUnchangedWhenUnderBudget(t *testing.T) {
	got := adaptiveCellSize(20, 20, 0.2)
	if math.Abs(got-0.2) > 1e-9 {
		t.Errorf("cellSize = %v, want unchanged 0.2 (well under budget)", got)
	}
}

func TestAdaptiveCellSizeGrowsWhenOverBudget(t *testing.T) {
	// 200x400 @ cellSize 0.2 -> (1000+1)*(2000+1) ≈ 2,002,001 칸, maxGridCells(400,000) 초과
	got := adaptiveCellSize(200, 400, 0.2)
	if got <= 0.2 {
		t.Fatalf("cellSize = %v, want > 0.2 (should coarsen for a huge area)", got)
	}
	cols := 200/got + 1
	rows := 400/got + 1
	if cols*rows > maxGridCells*1.01 { // 반올림 여유
		t.Errorf("cell count = %v still exceeds maxGridCells(%v) after adapting cellSize=%v", cols*rows, maxGridCells, got)
	}
}
