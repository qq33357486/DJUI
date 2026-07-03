import React from 'react'
import { Result, Button } from 'antd'

interface State {
  hasError: boolean
  error: Error | null
}

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('DJUI 渲染崩溃:', error, info.componentStack)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f1117' }}>
          <Result
            status="error"
            title="页面渲染崩溃"
            subTitle={this.state.error?.message ?? '未知错误'}
            extra={[
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
        </div>
      )
    }
    return this.props.children
  }
}
