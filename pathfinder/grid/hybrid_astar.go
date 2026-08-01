package grid

import (
	"container/heap"
	"errors"
	"math"
)

// Hybrid A* search parameters. These favor a small, maneuverable robot
// navigating an indoor floor plan rather than a car with a wide turning
// radius — see path-finding.md ("Hybrid A* 는 무조건 포함").
const (
	hybridStepLength     = 0.5                 // meters advanced per primitive
	hybridWheelBase      = 0.35                // meters; controls minimum turn radius
	hybridMaxSteerRad    = 35 * math.Pi / 180   // max steering angle per primitive
	hybridThetaResBins   = 48                   // heading discretization bins over 2*pi
	hybridGoalToleranceM = 0.35                 // meters; how close counts as "arrived"
	hybridMaxExpansions  = 300000               // safety cap so a hopeless search terminates
)

var hybridThetaResolution = 2 * math.Pi / hybridThetaResBins

var hybridSteerAngles = []float64{
	-hybridMaxSteerRad,
	-hybridMaxSteerRad / 2,
	0,
	hybridMaxSteerRad / 2,
	hybridMaxSteerRad,
}

// HybridResult is the outcome of a Hybrid A* search.
type HybridResult struct {
	Path     []Point
	Headings []float64 // radians, one per Path point
	Distance float64
}

type hybridState struct{ X, Y, Theta float64 }

type hybridNode struct {
	state  hybridState
	g      float64
	parent *hybridNode
}

type hybridKey struct{ xi, yi, ti int }

func normalizeAngle(a float64) float64 {
	a = math.Mod(a, 2*math.Pi)
	if a < 0 {
		a += 2 * math.Pi
	}
	return a
}

func discretizeHybrid(s hybridState, cellSize float64) hybridKey {
	return hybridKey{
		xi: int(math.Floor(s.X / cellSize)),
		yi: int(math.Floor(s.Y / cellSize)),
		ti: int(math.Floor(normalizeAngle(s.Theta) / hybridThetaResolution)),
	}
}

// stepState advances the simplified bicycle-model kinematics by one
// primitive: constant-radius arc (radius = wheelBase / tan(steer)) over
// hybridStepLength, approximated with a midpoint heading for the position
// update (accurate enough at this step length/resolution).
func stepState(s hybridState, steer float64) hybridState {
	curvature := math.Tan(steer) / hybridWheelBase
	deltaTheta := hybridStepLength * curvature
	midTheta := s.Theta + deltaTheta/2
	return hybridState{
		X:     s.X + hybridStepLength*math.Cos(midTheta),
		Y:     s.Y + hybridStepLength*math.Sin(midTheta),
		Theta: s.Theta + deltaTheta,
	}
}

type hybridPQItem struct {
	node     *hybridNode
	priority float64
	index    int
}

type hybridPQ []*hybridPQItem

func (pq hybridPQ) Len() int            { return len(pq) }
func (pq hybridPQ) Less(i, j int) bool  { return pq[i].priority < pq[j].priority }
func (pq hybridPQ) Swap(i, j int)       { pq[i], pq[j] = pq[j], pq[i]; pq[i].index = i; pq[j].index = j }
func (pq *hybridPQ) Push(x interface{}) {
	item := x.(*hybridPQItem)
	item.index = len(*pq)
	*pq = append(*pq, item)
}
func (pq *hybridPQ) Pop() interface{} {
	old := *pq
	n := len(old)
	item := old[n-1]
	*pq = old[:n-1]
	return item
}

// HybridAStar searches continuous (x, y, heading) space with simplified
// bicycle-model motion primitives, using a Dijkstra flood-fill over the
// occupancy grid ("holonomic-with-obstacles") as its heuristic so the
// search doesn't waste effort behind walls it can see are dead ends.
func HybridAStar(g *Grid, start, goal Point) (HybridResult, error) {
	if g.IsOccupiedPoint(start) {
		return HybridResult{}, errors.New("start point is inside an obstacle")
	}
	if g.IsOccupiedPoint(goal) {
		return HybridResult{}, errors.New("end point is inside an obstacle")
	}

	distField := distanceFieldFrom(g, goal)
	heuristic := func(p Point) float64 {
		col, row := g.CellAt(p)
		if d, ok := distField[cellKey{col, row}]; ok {
			return d
		}
		return dist(p, goal)
	}

	startHeading := math.Atan2(goal.Y-start.Y, goal.X-start.X)
	startState := hybridState{X: start.X, Y: start.Y, Theta: startHeading}
	startNode := &hybridNode{state: startState}

	open := &hybridPQ{}
	heap.Init(open)
	heap.Push(open, &hybridPQItem{node: startNode, priority: heuristic(start)})

	best := map[hybridKey]float64{discretizeHybrid(startState, g.CellSize): 0}

	var goalNode *hybridNode
	for open.Len() > 0 && goalNode == nil {
		if len(best) > hybridMaxExpansions {
			break
		}
		current := heap.Pop(open).(*hybridPQItem).node
		curPoint := Point{X: current.state.X, Y: current.state.Y}

		if dist(curPoint, goal) <= hybridGoalToleranceM {
			goalNode = current
			break
		}

		for _, steer := range hybridSteerAngles {
			next := stepState(current.state, steer)
			nextPoint := Point{X: next.X, Y: next.Y}
			midPoint := Point{X: (current.state.X + next.X) / 2, Y: (current.state.Y + next.Y) / 2}
			if g.IsOccupiedPoint(nextPoint) || g.IsOccupiedPoint(midPoint) {
				continue
			}

			key := discretizeHybrid(next, g.CellSize)
			tentativeG := current.g + hybridStepLength + math.Abs(steer)*0.1
			if prev, ok := best[key]; ok && prev <= tentativeG {
				continue
			}
			best[key] = tentativeG

			node := &hybridNode{state: next, g: tentativeG, parent: current}
			heap.Push(open, &hybridPQItem{node: node, priority: tentativeG + heuristic(nextPoint)})
		}
	}

	if goalNode == nil {
		return HybridResult{}, ErrNoPath
	}

	var path []Point
	var headings []float64
	for n := goalNode; n != nil; n = n.parent {
		path = append([]Point{{X: n.state.X, Y: n.state.Y}}, path...)
		headings = append([]float64{n.state.Theta}, headings...)
	}
	path = append(path, goal)
	headings = append(headings, headings[len(headings)-1])

	distance := 0.0
	for i := 1; i < len(path); i++ {
		distance += dist(path[i-1], path[i])
	}

	return HybridResult{Path: path, Headings: headings, Distance: distance}, nil
}
