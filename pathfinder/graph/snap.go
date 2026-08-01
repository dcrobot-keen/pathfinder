package graph

import (
	"errors"
	"fmt"
	"math"
)

// NodeSnapEpsilon: clicks within this distance (meters) of an existing
// node are treated as landing exactly on that node instead of creating a
// redundant virtual node next to it.
const NodeSnapEpsilon = 0.05

// SnapResult describes where a click landed relative to the graph.
// Exactly one of NodeID / EdgeID is set.
type SnapResult struct {
	NodeID       string
	EdgeID       string
	Point        Point
	SegmentIndex int // index i such that Point lies on segment [Polyline[i], Polyline[i+1]]
}

func closestPointOnSegment(a, b, p Point) (Point, float64) {
	dx, dy := b.X-a.X, b.Y-a.Y
	lenSq := dx*dx + dy*dy
	if lenSq == 0 {
		return a, a.distanceTo(p)
	}
	t := ((p.X-a.X)*dx + (p.Y-a.Y)*dy) / lenSq
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}
	proj := Point{X: a.X + t*dx, Y: a.Y + t*dy}
	return proj, proj.distanceTo(p)
}

// SnapToGraph finds the closest point on the graph (node or edge interior)
// to an arbitrary click coordinate, mirroring the "snapping" the 2D editor
// already does when drawing links.
func SnapToGraph(g *Graph, click Point) (SnapResult, error) {
	bestNodeID := ""
	bestNodeDist := math.MaxFloat64
	for id, p := range g.Nodes {
		if d := p.distanceTo(click); d < bestNodeDist {
			bestNodeDist = d
			bestNodeID = id
		}
	}
	if bestNodeID != "" && bestNodeDist <= NodeSnapEpsilon {
		return SnapResult{NodeID: bestNodeID, Point: g.Nodes[bestNodeID]}, nil
	}

	bestEdgeID := ""
	bestSegIdx := -1
	bestPoint := Point{}
	bestDist := math.MaxFloat64
	for _, edge := range g.Edges() {
		for i := 0; i < len(edge.Polyline)-1; i++ {
			proj, d := closestPointOnSegment(edge.Polyline[i], edge.Polyline[i+1], click)
			if d < bestDist {
				bestDist = d
				bestEdgeID = edge.ID
				bestSegIdx = i
				bestPoint = proj
			}
		}
	}

	if bestEdgeID == "" {
		if bestNodeID == "" {
			return SnapResult{}, errors.New("graph is empty")
		}
		return SnapResult{NodeID: bestNodeID, Point: g.Nodes[bestNodeID]}, nil
	}

	// 엣지 위 투영점이 그 엣지의 끝 노드와 사실상 같은 지점이면 노드로 스냅한다.
	edge := g.findEdgeByID(bestEdgeID)
	if edge != nil {
		if bestPoint.distanceTo(g.Nodes[edge.From]) <= NodeSnapEpsilon {
			return SnapResult{NodeID: edge.From, Point: g.Nodes[edge.From]}, nil
		}
		if bestPoint.distanceTo(g.Nodes[edge.To]) <= NodeSnapEpsilon {
			return SnapResult{NodeID: edge.To, Point: g.Nodes[edge.To]}, nil
		}
	}

	return SnapResult{EdgeID: bestEdgeID, Point: bestPoint, SegmentIndex: bestSegIdx}, nil
}

// InsertVirtualNode materializes a snap result as a graph node: if the
// snap already landed on an existing node it is returned unchanged,
// otherwise the underlying edge is split in two at the snapped point and
// a new node is inserted between them.
func (g *Graph) InsertVirtualNode(snap SnapResult, newNodeID string) (string, error) {
	if snap.NodeID != "" {
		return snap.NodeID, nil
	}

	edge := g.findEdgeByID(snap.EdgeID)
	if edge == nil {
		return "", fmt.Errorf("unknown edge %q", snap.EdgeID)
	}

	before := append(append([]Point{}, edge.Polyline[:snap.SegmentIndex+1]...), snap.Point)
	after := append([]Point{snap.Point}, edge.Polyline[snap.SegmentIndex+1:]...)
	from, to, id := edge.From, edge.To, edge.ID

	g.AddNode(newNodeID, snap.Point)
	g.removeEdgeByID(id)
	g.AddEdge(id+"-a", from, newNodeID, before)
	g.AddEdge(id+"-b", newNodeID, to, after)

	return newNodeID, nil
}
