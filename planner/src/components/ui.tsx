import { useEffect, useId, useState, type ReactNode } from 'react'

export function Section(props: { title: string; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="section" open={props.defaultOpen}>
      <summary>
        <span className="section-title">{props.title}</span>
        {props.summary && <span className="section-summary">{props.summary}</span>}
      </summary>
      <div className="section-body">{props.children}</div>
    </details>
  )
}

export function Field(props: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  )
}

/** A number input that lets you type freely (including an empty box) and only commits valid values. */
export function NumberField(props: {
  id?: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  decimals?: number
}) {
  const fmt = (v: number) => String(props.decimals !== undefined ? Number(v.toFixed(props.decimals)) : v)
  const [text, setText] = useState(fmt(props.value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(fmt(props.value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value, focused])
  return (
    <span className="number-field">
      <input
        id={props.id}
        type="number"
        inputMode="decimal"
        value={text}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setText(fmt(props.value))
        }}
        onChange={(e) => {
          setText(e.target.value)
          const v = e.target.valueAsNumber
          if (Number.isFinite(v)) props.onChange(Math.min(props.max, Math.max(props.min, v)))
        }}
      />
      {props.unit && <span className="unit">{props.unit}</span>}
    </span>
  )
}

export function Segmented<T extends string | number>(props: {
  label: string
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={o.id === props.value}
          className={o.id === props.value ? 'on' : ''}
          onClick={() => props.onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
