import cloudbase from '@cloudbase/js-sdk'

export const cloudbaseEnvId = import.meta.env.VITE_TCB_ENV_ID as string | undefined
export const isCloudBaseConfigured = Boolean(cloudbaseEnvId)

export const cloudbaseApp = isCloudBaseConfigured
  ? cloudbase.init({
      env: cloudbaseEnvId as string,
      timeout: 65_000,
    })
  : null

export const cloudbaseAuth = cloudbaseApp?.auth()
export const cloudbaseDb = cloudbaseApp?.database()

export type CloudbaseDatabase = NonNullable<typeof cloudbaseDb>

export const signInAnonymously = async () => {
  if (!cloudbaseAuth) {
    throw new Error('账号服务暂不可用')
  }

  const loginState = await cloudbaseAuth.getLoginState()
  if (loginState) {
    return loginState
  }

  await cloudbaseAuth.anonymousAuthProvider().signIn()
  const nextLoginState = await cloudbaseAuth.getLoginState()
  if (!nextLoginState) {
    throw new Error('登录失败，请稍后重试')
  }

  return nextLoginState
}
