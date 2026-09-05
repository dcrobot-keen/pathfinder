// Package grid implements obstacle-avoidance path search: block (polygon)
// features are rasterized into an occupancy grid, ignoring the node/link
// graph entirely (see path-finding.md mode 2 — "Cost map처럼 ... 노드
// 엣지를 사용하지 않고 장애물만 판단").
package grid

import (
	"fmt"
	"math"

	"pathfinder/graph"
)

// Point is a 2D planar coordinate in meters (shared with the graph package
// so callers can pass values between the two search modes unchanged).
type Point = graph.Point

func dist(a, b Point) float64 {
	return math.Hypot(a.X-b.X, a.Y-b.Y)
}

// Grid is a regular occupancy grid over a rectangular area.
type Grid struct {
	OriginX  float64
	OriginY  float64
	CellSize float64
	Cols     int
	Rows     int
	occupied []bool // row-major, length Cols*Rows
	// raw is the occupancy before Inflate() grew it (nil until Inflate runs).
	// ClearDisc only frees cells that were free here, so carving the robot's
	// start position never opens a path through a real obstacle it is touching.
	raw []bool
}

// NewGrid creates an empty (fully free) grid covering
// [originX, originX+cols*cellSize) x [originY, originY+rows*cellSize).
func NewGrid(originX, originY, cellSize float64, cols, rows int) *Grid {
	return &Grid{
		OriginX:  originX,
		OriginY:  originY,
		CellSize: cellSize,
		Cols:     cols,
		Rows:     rows,
		occupied: make([]bool, cols*rows),
	}
}

// NewGridFromOccupancy builds a Grid directly from a pre-computed occupancy
// bitmap (row-major, length cols*rows), for callers that already maintain
// their own cell-level occupancy (e.g. a LIDAR-fed local costmap) and don't
// need polygon rasterization -- see RasterizeBlocks for the GeoJSON-polygon
// path this package otherwise expects its callers to use.
func NewGridFromOccupancy(originX, originY, cellSize float64, cols, rows int, occupied []bool) (*Grid, error) {
	if len(occupied) != cols*rows {
		return nil, fmt.Errorf("occupied has length %d, want cols*rows = %d", len(occupied), cols*rows)
	}
	g := NewGrid(originX, originY, cellSize, cols, rows)
	copy(g.occupied, occupied)
	return g, nil
}

func (g *Grid) index(col, row int) int { return row*g.Cols + col }

// InBounds reports whether a cell index is within the grid.
func (g *Grid) InBounds(col, row int) bool {
	return col >= 0 && col < g.Cols && row >= 0 && row < g.Rows
}

// CellAt returns the grid cell containing a world point.
func (g *Grid) CellAt(p Point) (col, row int) {
	col = int((p.X - g.OriginX) / g.CellSize)
	row = int((p.Y - g.OriginY) / g.CellSize)
	return
}

// WorldAt returns the world-space center of a cell.
func (g *Grid) WorldAt(col, row int) Point {
	return Point{
		X: g.OriginX + (float64(col)+0.5)*g.CellSize,
		Y: g.OriginY + (float64(row)+0.5)*g.CellSize,
	}
}

// IsOccupiedCell reports whether a cell is blocked (or out of bounds).
func (g *Grid) IsOccupiedCell(col, row int) bool {
	if !g.InBounds(col, row) {
		return true
	}
	return g.occupied[g.index(col, row)]
}

// IsOccupiedPoint reports whether the cell containing a world point is
// blocked (or the point falls outside the grid).
func (g *Grid) IsOccupiedPoint(p Point) bool {
	col, row := g.CellAt(p)
	return g.IsOccupiedCell(col, row)
}

func (g *Grid) setOccupied(col, row int) {
	if g.InBounds(col, row) {
		g.occupied[g.index(col, row)] = true
	}
}

// pointInPolygon uses the standard ray-casting test. ring is a closed
// polygon ring (first point == last point, as GeoJSON requires).
func pointInPolygon(p Point, ring []Point) bool {
	inside := false
	n := len(ring)
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		pi, pj := ring[i], ring[j]
		intersects := (pi.Y > p.Y) != (pj.Y > p.Y)
		if intersects {
			xCross := (pj.X-pi.X)*(p.Y-pi.Y)/(pj.Y-pi.Y) + pi.X
			if p.X < xCross {
				inside = !inside
			}
		}
	}
	return inside
}

// RasterizeBlocks marks every cell whose center falls inside any of the
// given polygons (each a single ring) as occupied.
func (g *Grid) RasterizeBlocks(blocks [][]Point) {
	for row := 0; row < g.Rows; row++ {
		for col := 0; col < g.Cols; col++ {
			center := g.WorldAt(col, row)
			for _, ring := range blocks {
				if len(ring) < 3 {
					continue
				}
				if pointInPolygon(center, ring) {
					g.setOccupied(col, row)
					break
				}
			}
		}
	}
}

// Bounds computes a grid origin/size that covers all given points with the
// requested padding (meters) on every side.
func Bounds(points []Point, padding, cellSize float64) (originX, originY float64, cols, rows int) {
	if len(points) == 0 {
		return 0, 0, 1, 1
	}
	minX, minY := points[0].X, points[0].Y
	maxX, maxY := points[0].X, points[0].Y
	for _, p := range points[1:] {
		if p.X < minX {
			minX = p.X
		}
		if p.Y < minY {
			minY = p.Y
		}
		if p.X > maxX {
			maxX = p.X
		}
		if p.Y > maxY {
			maxY = p.Y
		}
	}
	originX = minX - padding
	originY = minY - padding
	width := (maxX - minX) + 2*padding
	height := (maxY - minY) + 2*padding
	cols = int(width/cellSize) + 1
	rows = int(height/cellSize) + 1
	if cols < 1 {
		cols = 1
	}
	if rows < 1 {
		rows = 1
	}
	return
}

// Inflate grows every occupied cell by radiusM (Euclidean distance between
// cell centers), so a path planned through the remaining free cells keeps at
// least that clearance from the original obstacles. Callers pass the robot's
// body radius plus a safety margin; without this the planner happily routes a
// cell-center path along a wall and a real body (or the simulator's) collides.
func (g *Grid) Inflate(radiusM float64) {
	if radiusM <= 0 {
		return
	}
	r := int(math.Ceil(radiusM / g.CellSize))
	r2 := radiusM * radiusM
	type offset struct{ dc, dr int }
	var disc []offset
	for dr := -r; dr <= r; dr++ {
		for dc := -r; dc <= r; dc++ {
			dx := float64(dc) * g.CellSize
			dy := float64(dr) * g.CellSize
			if dx*dx+dy*dy <= r2+1e-9 {
				disc = append(disc, offset{dc, dr})
			}
		}
	}
	src := make([]bool, len(g.occupied))
	copy(src, g.occupied)
	g.raw = src
	for row := 0; row < g.Rows; row++ {
		for col := 0; col < g.Cols; col++ {
			if !src[row*g.Cols+col] {
				continue
			}
			for _, o := range disc {
				g.setOccupied(col+o.dc, row+o.dr)
			}
		}
	}
}

// ClearDisc frees every cell whose center lies within radiusM of p that was
// NOT an obstacle before Inflate (only the inflated ring is carved). Used for
// the robot's own start position: the body is physically there, so the ring
// around a nearby wall must not swallow the start cell and make every plan
// fail with "start is occupied" -- but the wall itself stays a wall.
func (g *Grid) ClearDisc(p Point, radiusM float64) {
	if radiusM <= 0 {
		return
	}
	c0, r0 := g.CellAt(p)
	r := int(math.Ceil(radiusM/g.CellSize)) + 1
	for row := r0 - r; row <= r0+r; row++ {
		for col := c0 - r; col <= c0+r; col++ {
			if !g.InBounds(col, row) {
				continue
			}
			if dist(g.WorldAt(col, row), p) > radiusM+1e-9 {
				continue
			}
			if g.raw != nil && g.raw[g.index(col, row)] {
				continue // a real obstacle cell, never carve
			}
			g.occupied[g.index(col, row)] = false
		}
	}
}
