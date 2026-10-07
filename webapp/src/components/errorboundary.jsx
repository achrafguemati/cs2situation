import { Component } from "react";

// Catches a render crash in one component so the radar keeps working instead of
// going to a blank white page. Data here is 10Hz and partly untrusted (any field
// can be missing between round transitions), so a single unguarded read used to be
// enough to take the entire tree down.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("radar render error:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-red-300 font-mono text-xs">
          <div className="text-red-400 font-bold mb-2">Radar stopped rendering</div>
          <div className="mb-3 opacity-80">{String(this.state.error?.message || this.state.error)}</div>
          <button
            className="px-3 py-1 rounded bg-white/10 border border-white/20 hover:bg-white/20"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;