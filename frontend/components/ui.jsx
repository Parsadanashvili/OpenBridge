import {
  Component,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
} from "react";
import { Activity, ArrowUpRight, Check, ChevronRight, X } from "lucide-react";
import { LoadingIndicator } from "./LoadingIndicator";

export function Brand({ compact = false }) {
  return (
    <a
      className="brand"
      href="/studio?tenant=demo-tpp"
      aria-label="OpenBridge home"
    >
      <span className="brand-mark">
        <Activity size={23} strokeWidth={2.5} />
      </span>
      {!compact && (
        <span>
          openbridge<span className="brand-dot">.</span>
        </span>
      )}
    </a>
  );
}

export function Button({
  icon: Icon,
  children,
  variant = "",
  loading,
  className = "",
  ...props
}) {
  return (
    <button
      className={`button ${variant} ${className}`}
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <LoadingIndicator size={15} /> : Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className = "", ...props }) {
  return (
    <button
      className={`icon-button ${className}`}
      type="button"
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={17} />
    </button>
  );
}

export function Badge({ children, tone = "neutral" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Field({ label, hint, children }) {
  const generated = useId();
  const control =
    isValidElement(children) &&
    ["input", "select", "textarea"].includes(children.type);
  const id = children?.props?.id || generated;
  return (
    <div className="field">
      <label className="field-label" htmlFor={control ? id : undefined}>
        {label}
      </label>
      {control
        ? cloneElement(children, {
            id,
            "aria-describedby": hint ? `${id}-hint` : undefined,
          })
        : children}
      {hint && (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function Empty({ icon: Icon = Activity, title, children, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={24} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Modal({ title, description, children, onClose, wide = false }) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={description ? `${titleId}-description` : undefined}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={`${titleId}-description`}>{description}</p>}
        </div>
        <IconButton icon={X} label="Close dialog" onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}

export function Toast({ message, error, onClose }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onClose, error ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [message, error, onClose]);
  if (!message) return null;
  return (
    <div
      className={`toast ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {error ? <Activity size={16} /> : <Check size={16} />}
      <span>{message}</span>
      <IconButton icon={X} label="Dismiss notification" onClick={onClose} />
    </div>
  );
}

export function Breadcrumbs({ items }) {
  return (
    <div className="breadcrumbs">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <ChevronRight size={13} />}
          {item}
        </span>
      ))}
    </div>
  );
}

export function ExternalLink({ href, children }) {
  return (
    <a className="external-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}

export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="fatal-error">
          <h1>Something went wrong</h1>
          <p>{this.state.error.message}</p>
          <Button onClick={() => location.reload()}>Reload workspace</Button>
        </div>
      );
    return this.props.children;
  }
}
