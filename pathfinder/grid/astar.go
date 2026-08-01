package grid

import (
	"container/heap"
	"errors"
	"math"
)

// ErrNoPath is returned when no free-space route connects start and goal.
var ErrNoPath = errors.New("no path found around obstacles")

// Result is the outcome of a grid search.
type Result struct {
	Path     []Point
	Distance float64
}

type cellKey struct{ col, row int }

type gridPQItem struct {
	key      cellKey
	priority float64
	gScore   float64
	index    int
}

type gridPQ []*gridPQItem

func (pq gridPQ) Len() int           { return len(pq) }
func (pq gridPQ) Less(i, j int) bool { return pq[i].priority < pq[j].priority }
func (pq gridPQ) Swap(i, j int)      { pq[i], pq[j] = pq[j], pq[i]; pq[i].index = i; pq[j].index = j }
func (pq *gridPQ) Push(x interface{}) {
	item := x.(*gridPQItem)
	item.index = len(*pq)
	*pq = append(*pq, item)
}
func (pq *gridPQ) Pop() interface{} {
	old := *pq
	n := len(old)
	item := old[n-1]
	*pq = old[:n-1]
	return item
}

var eightNeighbors = [8][2]int{
	{1, 0}, {-1, 0}, {0, 1}, {0, -1},
	{1, 1}, {1, -1}, {-1, 1}, {-1, -1},
}

// GridAStar searches an 8-connected occupancy grid for the shortest
// obstacle-free route from start to goal (both in world coordinates).
func GridAStar(g *Grid, start, goal Point) (Result, error) {
	startCol, startRow := g.CellAt(start)
	goalCol, goalRow := g.CellAt(goal)

	if g.IsOccupiedCell(startCol, startRow) {
		return Result{}, errors.New("start point is inside an obstacle")
	}
	if g.IsOccupiedCell(goalCol, goalRow) {
		return Result{}, errors.New("end point is inside an obstacle")
	}

	goalWorld := g.WorldAt(goalCol, goalRow)
	heuristic := func(col, row int) float64 {
		return dist(g.WorldAt(col, row), goalWorld)
	}

	startKey := cellKey{startCol, startRow}
	goalKey := cellKey{goalCol, goalRow}

	gScore := map[cellKey]float64{startKey: 0}
	cameFrom := map[cellKey]cellKey{}
	visited := map[cellKey]bool{}

	pq := &gridPQ{}
	heap.Init(pq)
	heap.Push(pq, &gridPQItem{key: startKey, priority: heuristic(startCol, startRow)})

	found := false
	for pq.Len() > 0 {
		current := heap.Pop(pq).(*gridPQItem)
		if visited[current.key] {
			continue
		}
		visited[current.key] = true

		if current.key == goalKey {
			found = true
			break
		}

		for _, d := range eightNeighbors {
			nc, nr := current.key.col+d[0], current.key.row+d[1]
			if visited[cellKey{nc, nr}] || g.IsOccupiedCell(nc, nr) {
				continue
			}
			diagonal := d[0] != 0 && d[1] != 0
			if diagonal && (g.IsOccupiedCell(current.key.col+d[0], current.key.row) || g.IsOccupiedCell(current.key.col, current.key.row+d[1])) {
				continue // no cutting across a blocked corner
			}
			stepCost := g.CellSize
			if diagonal {
				stepCost *= math.Sqrt2
			}
			tentative := gScore[current.key] + stepCost
			nk := cellKey{nc, nr}
			if existing, ok := gScore[nk]; !ok || tentative < existing {
				gScore[nk] = tentative
				cameFrom[nk] = current.key
				heap.Push(pq, &gridPQItem{key: nk, priority: tentative + heuristic(nc, nr), gScore: tentative})
			}
		}
	}

	if !found {
		return Result{}, ErrNoPath
	}

	var cells []cellKey
	for k := goalKey; k != startKey; k = cameFrom[k] {
		cells = append([]cellKey{k}, cells...)
	}
	cells = append([]cellKey{startKey}, cells...)

	path := make([]Point, 0, len(cells))
	path = append(path, start)
	for _, c := range cells[1 : len(cells)-1] {
		path = append(path, g.WorldAt(c.col, c.row))
	}
	path = append(path, goal)

	distance := 0.0
	for i := 1; i < len(path); i++ {
		distance += dist(path[i-1], path[i])
	}

	return Result{Path: path, Distance: distance}, nil
}

// distanceFieldFrom runs a Dijkstra flood-fill from source across every
// reachable free cell, returning cost-to-source for each. This is the
// standard "holonomic-with-obstacles" heuristic used to guide Hybrid A*
// away from dead ends without the cost of full kinematic search.
func distanceFieldFrom(g *Grid, source Point) map[cellKey]float64 {
	startCol, startRow := g.CellAt(source)
	startKey := cellKey{startCol, startRow}
	distField := map[cellKey]float64{}
	if g.IsOccupiedCell(startCol, startRow) {
		return distField
	}
	distField[startKey] = 0
	visited := map[cellKey]bool{}

	pq := &gridPQ{}
	heap.Init(pq)
	heap.Push(pq, &gridPQItem{key: startKey, priority: 0})

	for pq.Len() > 0 {
		current := heap.Pop(pq).(*gridPQItem)
		if visited[current.key] {
			continue
		}
		visited[current.key] = true

		for _, d := range eightNeighbors {
			nc, nr := current.key.col+d[0], current.key.row+d[1]
			nk := cellKey{nc, nr}
			if visited[nk] || g.IsOccupiedCell(nc, nr) {
				continue
			}
			diagonal := d[0] != 0 && d[1] != 0
			if diagonal && (g.IsOccupiedCell(current.key.col+d[0], current.key.row) || g.IsOccupiedCell(current.key.col, current.key.row+d[1])) {
				continue
			}
			step := g.CellSize
			if diagonal {
				step *= math.Sqrt2
			}
			tentative := distField[current.key] + step
			if existing, ok := distField[nk]; !ok || tentative < existing {
				distField[nk] = tentative
				heap.Push(pq, &gridPQItem{key: nk, priority: tentative})
			}
		}
	}

	return distField
}
