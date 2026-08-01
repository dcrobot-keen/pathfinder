package graph

import (
	"container/heap"
	"errors"
	"fmt"
)

// Algorithm selects which graph search strategy ShortestPath uses.
type Algorithm string

const (
	Dijkstra Algorithm = "dijkstra"
	AStar    Algorithm = "astar"
)

// ErrNoPath is returned when start and end are not connected.
var ErrNoPath = errors.New("no path between start and end")

// Result is the outcome of a shortest-path search.
type Result struct {
	NodeSequence []string  // node ids visited, in order, start..end
	Path         []Point   // full polyline (edge geometries concatenated)
	Distance     float64   // total path length in meters
	Algorithm    Algorithm
}

type pqItem struct {
	nodeID   string
	priority float64 // gScore (+ heuristic for A*)
	gScore   float64
	index    int
}

type priorityQueue []*pqItem

func (pq priorityQueue) Len() int            { return len(pq) }
func (pq priorityQueue) Less(i, j int) bool  { return pq[i].priority < pq[j].priority }
func (pq priorityQueue) Swap(i, j int)       { pq[i], pq[j] = pq[j], pq[i]; pq[i].index = i; pq[j].index = j }
func (pq *priorityQueue) Push(x interface{}) {
	item := x.(*pqItem)
	item.index = len(*pq)
	*pq = append(*pq, item)
}
func (pq *priorityQueue) Pop() interface{} {
	old := *pq
	n := len(old)
	item := old[n-1]
	*pq = old[:n-1]
	return item
}

// ShortestPath finds the shortest route from startID to endID.
// algo == Dijkstra uses zero heuristic; algo == AStar uses straight-line
// distance to the goal (admissible for Euclidean edge weights, so both
// return an optimal path — A* simply visits fewer nodes).
func ShortestPath(g *Graph, startID, endID string, algo Algorithm) (Result, error) {
	if _, ok := g.Nodes[startID]; !ok {
		return Result{}, fmt.Errorf("unknown start node %q", startID)
	}
	goal, ok := g.Nodes[endID]
	if !ok {
		return Result{}, fmt.Errorf("unknown end node %q", endID)
	}

	heuristic := func(nodeID string) float64 {
		if algo != AStar {
			return 0
		}
		return g.Nodes[nodeID].distanceTo(goal)
	}

	gScore := map[string]float64{startID: 0}
	cameFrom := map[string]Edge{}
	visited := map[string]bool{}

	pq := &priorityQueue{}
	heap.Init(pq)
	heap.Push(pq, &pqItem{nodeID: startID, priority: heuristic(startID), gScore: 0})

	for pq.Len() > 0 {
		current := heap.Pop(pq).(*pqItem)
		if visited[current.nodeID] {
			continue
		}
		visited[current.nodeID] = true

		if current.nodeID == endID {
			return buildResult(g, startID, endID, cameFrom, gScore[endID], algo), nil
		}

		for _, edge := range g.Neighbors(current.nodeID) {
			if visited[edge.To] {
				continue
			}
			tentativeG := gScore[current.nodeID] + edge.Weight
			if existing, ok := gScore[edge.To]; !ok || tentativeG < existing {
				gScore[edge.To] = tentativeG
				cameFrom[edge.To] = edge
				heap.Push(pq, &pqItem{
					nodeID:   edge.To,
					priority: tentativeG + heuristic(edge.To),
					gScore:   tentativeG,
				})
			}
		}
	}

	return Result{}, ErrNoPath
}

func buildResult(g *Graph, startID, endID string, cameFrom map[string]Edge, distance float64, algo Algorithm) Result {
	var nodeSeq []string
	var edgesUsed []Edge
	node := endID
	for node != startID {
		edge := cameFrom[node]
		edgesUsed = append(edgesUsed, edge)
		nodeSeq = append([]string{node}, nodeSeq...)
		node = edge.From
	}
	nodeSeq = append([]string{startID}, nodeSeq...)

	var path []Point
	for i := len(edgesUsed) - 1; i >= 0; i-- {
		edge := edgesUsed[i]
		if len(path) > 0 {
			// avoid duplicating the shared vertex between consecutive edges
			path = append(path, edge.Polyline[1:]...)
		} else {
			path = append(path, edge.Polyline...)
		}
	}
	if len(path) == 0 {
		path = []Point{g.Nodes[startID]}
	}

	return Result{NodeSequence: nodeSeq, Path: path, Distance: distance, Algorithm: algo}
}
