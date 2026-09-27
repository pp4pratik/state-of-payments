import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { useChatbotData } from '../lib/chatbot/useChatbotData'
import { answerQuestion, EXAMPLE_QUESTIONS, type ChatAnswer } from '../lib/chatbot/engine'

type Message = { role: 'user' | 'bot'; answer: ChatAnswer }

const GREETING: ChatAnswer = {
  text: "Ask me about UPI, AutoPay, RBI Cards, RBI Payments, Geography, or Circulars — I'll answer from this site's own data.",
}

export function ChatBox() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const { isReady, data } = useChatbotData()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  function ask(question: string) {
    const q = question.trim()
    if (!q || !data) return
    const answer = answerQuestion(q, data)
    setMessages((m) => [...m, { role: 'user', answer: { text: q } }, { role: 'bot', answer }])
    setInput('')
  }

  return (
    <>
      <button
        type="button"
        className="chatbox-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close data assistant' : 'Ask the data assistant'}
        aria-expanded={open}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>

      {open && (
        <div className="chatbox-panel" role="dialog" aria-label="Data assistant">
          <div className="chatbox-header">
            <p className="chatbox-title">Ask the data</p>
            <p className="chatbox-subtitle">Answers computed live from this site's own dataset</p>
          </div>

          <div className="chatbox-messages" ref={listRef}>
            <ChatBubble role="bot" answer={GREETING} />
            {messages.map((m, i) => (
              <ChatBubble key={i} role={m.role} answer={m.answer} />
            ))}
            {!isReady && <p className="section-note">Loading data…</p>}
            {isReady && messages.length === 0 && (
              <div className="chatbox-suggestions">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button key={q} type="button" className="chatbox-suggestion" onClick={() => ask(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="chatbox-input-row"
            onSubmit={(e) => {
              e.preventDefault()
              ask(input)
            }}
          >
            <input
              ref={inputRef}
              type="text"
              className="chatbox-input"
              placeholder={isReady ? 'Ask about UPI, AutoPay, RBI, states…' : 'Loading data…'}
              value={input}
              disabled={!isReady}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className="chatbox-send" disabled={!isReady || !input.trim()} aria-label="Send">
              <Send size={15} />
            </button>
          </form>
        </div>
      )}
    </>
  )
}

function ChatBubble({ role, answer }: { role: 'user' | 'bot'; answer: ChatAnswer }) {
  return (
    <div className={`chatbox-bubble ${role}`}>
      <p className="chatbox-bubble-text">{answer.text}</p>
      {answer.table && (
        <div className="table-scroll chatbox-table-wrap">
          <table>
            <thead>
              <tr>
                {answer.table.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {answer.table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
