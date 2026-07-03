import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ConfigProvider
        locale={zhCN}
        theme={{ algorithm: theme.darkAlgorithm }}
      >
        <App />
      </ConfigProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
)
