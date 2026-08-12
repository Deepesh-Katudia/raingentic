/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_EMAIL: string
  readonly VITE_DEMO_PASSWORD: string
  readonly VITE_DEMO_CARD_NAME: string
  readonly VITE_DEMO_CARD_NUMBER: string
  readonly VITE_DEMO_CARD_EXPIRY: string
  readonly VITE_DEMO_CARD_CVC: string
  readonly VITE_ADMIN_EMAIL: string
  readonly VITE_ADMIN_PASSWORD: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
