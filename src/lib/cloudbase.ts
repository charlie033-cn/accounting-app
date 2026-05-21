import cloudbase from '@cloudbase/js-sdk'

export const cloudbaseEnvId = import.meta.env.VITE_TCB_ENV_ID as string | undefined
export const isCloudBaseConfigured = Boolean(cloudbaseEnvId)

export const cloudbaseApp = isCloudBaseConfigured
  ? cloudbase.init({
      env: cloudbaseEnvId as string,
    })
  : null

export const cloudbaseAuth = cloudbaseApp?.auth()
export const cloudbaseDb = cloudbaseApp?.database()

export type CloudbaseDatabase = NonNullable<typeof cloudbaseDb>

export const signInAnonymously = async () => {
  if (!cloudbaseAuth) {
    throw new Error('CloudBase 环境未配置')
  }

  const loginState = await cloudbaseAuth.getLoginState()
  if (loginState) {
    return loginState
  }

  await cloudbaseAuth.anonymousAuthProvider().signIn()
  const nextLoginState = await cloudbaseAuth.getLoginState()
  if (!nextLoginState) {
    throw new Error('CloudBase 匿名登录失败')
  }

  return nextLoginState
}
