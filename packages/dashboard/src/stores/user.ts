// core/web/src/stores/user.ts —— 用户认证状态管理
import { ref, computed } from 'vue'

export interface UserInfo {
  id: string
  username: string
  displayName: string
  avatar?: string
}

// 用户状态
export const currentUser = ref<UserInfo | null>(null)
export const token = ref<string | null>(localStorage.getItem('token'))

// 计算属性
export const isLoggedIn = computed(() => !!currentUser.value && !!token.value)

// 登录函数
export async function login(username: string, password: string): Promise<boolean> {
  try {
    // TODO: 调用后端登录接口
    // const res = await fetch('/api/login', { ... })
    
    // 临时模拟登录成功
    const mockUser: UserInfo = {
      id: '1',
      username: username,
      displayName: username,
      avatar: undefined
    }
    const mockToken = 'mock-token-' + Date.now()
    
    currentUser.value = mockUser
    token.value = mockToken
    localStorage.setItem('token', mockToken)
    
    return true
  } catch (error) {
    console.error('登录失败:', error)
    return false
  }
}

// 登出函数
export function logout() {
  currentUser.value = null
  token.value = null
  localStorage.removeItem('token')
}

// 初始化时检查 token
export async function checkAuth() {
  if (!token.value) return false
  
  try {
    // TODO: 调用后端接口验证 token
    // const res = await fetch('/api/user/info', { headers: { Authorization: `Bearer ${token.value}` } })
    
    // 临时模拟获取用户信息
    currentUser.value = {
      id: '1',
      username: 'admin',
      displayName: 'Admin',
      avatar: undefined
    }
    
    return true
  } catch (error) {
    console.error('验证 token 失败:', error)
    logout()
    return false
  }
}
