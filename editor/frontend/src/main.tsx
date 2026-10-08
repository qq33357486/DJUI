import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './index.css'
import { installLocalAutomation } from './lib/localAutomation'
import RenderShotApp, { parseRenderHash } from './lib/renderShot'

installLocalAutomation()

// #render?port=..&page=.. → 无头渲染模式（djui-shot.mjs 直连出图，不进编辑器 UI）
const renderShotParams = parseRenderHash()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      {renderShotParams ? (
        <RenderShotApp params={renderShotParams} />
      ) : (
        <ConfigProvider
          locale={zhCN}
          theme={{ algorithm: theme.darkAlgorithm }}
        >
          <App />
        </ConfigProvider>
      )}
    </AppErrorBoundary>
  </React.StrictMode>,
)
