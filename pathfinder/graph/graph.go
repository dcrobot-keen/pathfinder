// Package graph implements shortest-path search over the node/link graph
// drawn in the 2D map editor (see src/editLayer.js). Coordinates are plain
// planar meters (the app's "indoor-plane" projection), not lon/lat.
package graph

import "math"

// Point is a 2D planar coordinate in meters.
type Point struct {
	X float64
	Y float64
}

func (p Point) distanceTo(o Point) float64 {
	dx := p.X - o.X
	dy := p.Y - o.Y
	return math.Hypot(dx, dy)
}

// Edge connects two nodes and carries the full polyline geometry between
// them (a drawn link can have intermediate shape points, not just a
// straight line from node to node).
type Edge struct {
	ID       string
	From     string
	To       string
	Polyline []Point
	Weight   float64 // polyline length in meters
}

// Graph is an undirected weighted graph built from node/link features.
type Graph struct {
	Nodes map[string]Point
	edges map[string][]Edge // adjacency list keyed by node id
	all   []Edge
}

// NewGraph creates an empty graph.
func NewGraph() *Graph {
	return &Graph{
		Nodes: make(map[string]Point),
		edges: make(map[string][]Edge),
	}
}

// AddNode registers a node at the given point, returning its id.
func (g *Graph) AddNode(id string, p Point) {
	g.Nodes[id] = p
}

func polylineLength(pts []Point) float64 {
	total := 0.0
	for i := 1; i < len(pts); i++ {
		total += pts[i-1].distanceTo(pts[i])
	}
	return total
}

// AddEdge connects two existing nodes with the given polyline (which must
// start at the "from" node's point and end at the "to" node's point).
func (g *Graph) AddEdge(id, from, to string, polyline []Point) {
	edge := Edge{ID: id, From: from, To: to, Polyline: polyline, Weight: polylineLength(polyline)}
	g.edges[from] = append(g.edges[from], edge)

	reversed := make([]Point, len(polyline))
	for i, p := range polyline {
		reversed[len(polyline)-1-i] = p
	}
	g.edges[to] = append(g.edges[to], Edge{ID: id, From: to, To: from, Polyline: reversed, Weight: edge.Weight})

	g.all = append(g.all, edge)
}

// Neighbors returns the outgoing edges from a node.
func (g *Graph) Neighbors(nodeID string) []Edge {
	return g.edges[nodeID]
}

// Edges returns every edge exactly once (forward direction only).
func (g *Graph) Edges() []Edge {
	return g.all
}

func (g *Graph) findEdgeByID(id string) *Edge {
	for i := range g.all {
		if g.all[i].ID == id {
			return &g.all[i]
		}
	}
	return nil
}

// removeEdgeByID drops an edge (both directions) from the graph.
func (g *Graph) removeEdgeByID(id string) {
	filtered := g.all[:0]
	for _, e := range g.all {
		if e.ID != id {
			filtered = append(filtered, e)
		}
	}
	g.all = filtered

	for nodeID, edges := range g.edges {
		kept := edges[:0]
		for _, e := range edges {
			if e.ID != id {
				kept = append(kept, e)
			}
		}
		g.edges[nodeID] = kept
	}
}
