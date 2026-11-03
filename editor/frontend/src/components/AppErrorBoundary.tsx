import React from 'react'
import { Result, Button, ConfigProvider, theme } from 'antd'
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons'
import { APP_VERSION } from '@/lib/changelog'

interface State {
  hasError: boolean
  error: Error | null
  componentStack: string | null
  copied: boolean
}

// 精简错误摘要里错误消息的最大长度：超过截断加省略号，避免用户复制一大串发给多杰
const BRIEF_MESSAGE_MAX = 300

// 从 stack 中提取首个调用帧（"at xxx (file:line:col)"），作为摘要里的「位置」行
function firstStackFrame(stack?: string): string | null {
  if (!stack) return null
  for (const line of stack.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('at ')) return trimmed.slice(3)
  }
  return null
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatTimestamp(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function formatFileStamp(d: Date) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

// 复制用精简摘要：版本 + 一行错误 + 一行位置，控制在几行内方便直接粘贴
function buildBriefReport(error: Error): string {
  const raw = error.message || '未知错误'
  const msg = raw.length > BRIEF_MESSAGE_MAX ? raw.slice(0, BRIEF_MESSAGE_MAX) + '…' : raw
  const lines = [
    '【DJUI 错误反馈】',
    `版本：v${APP_VERSION}`,
    `错误：${msg}`,
  ]
  const frame = firstStackFrame(error.stack)
  if (frame) lines.push(`位置：${frame}`)
  return lines.join('\n')
}

// 完整错误日志：精简摘要放不下的一切排查信息（环境、完整堆栈、组件栈），供下载
function buildFullLog(error: Error, componentStack: string | null): string {
  const lines = [
    'DJUI 编辑器错误日志',
    '========================================',
    `版本：v${APP_VERSION}`,
    `时间：${formatTimestamp(new Date())}`,
    `页面地址：${window.location.href}`,
    `浏览器：${navigator.userAgent}`,
  ]
  try {
    const pageId = localStorage.getItem('djui.project.lastPage')
    if (pageId) lines.push(`记忆页面 ID：${pageId}`)
  } catch { /* localStorage 不可用时跳过 */ }
  lines.push('', '[错误消息]', error.message || '未知错误')
  if (error.stack) lines.push('', '[调用堆栈]', error.stack)
  if (componentStack) lines.push('', '[React 组件栈]', componentStack.trim())
  return lines.join('\n')
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 降级：隐藏 textarea + execCommand（非安全上下文 / 权限受限时 clipboard API 不可用）
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null, componentStack: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('DJUI 渲染崩溃:', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  handleCopy = async () => {
    const { error } = this.state
    if (!error) return
    const ok = await copyText(buildBriefReport(error))
    if (ok) {
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 4000)
    }
  }

  handleDownloadLog = () => {
    const { error, componentStack } = this.state
    if (!error) return
    const blob = new Blob([buildFullLog(error, componentStack)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `djui-error-${formatFileStamp(new Date())}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  render() {
    if (this.state.hasError) {
      const { error, copied } = this.state
      return (
        // 错误边界位于 ConfigProvider 外层，需自带暗色主题保证可读
        <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f1117' }}>
            <div>
              <Result
                status="error"
                title="页面渲染崩溃"
                subTitle={
                  <div style={{ maxWidth: 560 }}>
                    <div style={{ wordBreak: 'break-all' }}>{error?.message ?? '未知错误'}</div>
                  </div>
                }
                extra={[
                  <Button key="copy" icon={<CopyOutlined />} onClick={this.handleCopy}>
                    {copied ? '已复制 ✓' : '复制错误信息'}
                  </Button>,
                  <Button key="log" icon={<DownloadOutlined />} onClick={this.handleDownloadLog}>
                    下载完整日志
                  </Button>,
                  <Button key="reload" type="primary" onClick={this.handleReload}>
                    刷新页面
                  </Button>,
                  <Button key="clear" onClick={() => {
                    localStorage.removeItem('djui.project.lastPage')
                    this.handleReload()
                  }}>
                    清除记忆的页面并刷新
                  </Button>,
                ]}
              />
              <div style={{ textAlign: 'center', color: '#8b93a7', fontSize: 12, marginTop: -16 }}>
                复制错误信息后发给多杰，可快速定位修复问题；错误内容较长时请下载完整日志一并发送
              </div>
            </div>
          </div>
        </ConfigProvider>
      )
    }
    return this.props.children
  }
}
