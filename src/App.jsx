import { useState, useEffect, useRef } from 'react'
import { 
  ShoppingBag, ShoppingCart, Trash2, Plus, Minus, Check, Truck, 
  Settings, LogOut, Package, Edit, MapPin, User, Phone, ArrowLeft, 
  Search, FileText, X, ChevronRight, Info, ExternalLink, RefreshCw, PlusCircle, Calendar,
  Star, Scale, CheckSquare, Square, TrendingUp, DollarSign, Undo2, MessageSquare, Tag, Users, ClipboardList, Copy, Bell, SlidersHorizontal, Sparkles, Egg, Layers, ReceiptText, Eye, EyeOff, Key, Lock
} from 'lucide-react'
import { supabase, isSupabaseConfigured, updateSupabaseHeaders } from './supabaseClient'

// Constants
const ADMIN_PHONE = import.meta.env.VITE_ADMIN_PHONE || ''

// ─── Security: Input Validation & Sanitization Helpers ───
const sanitizeText = (text, maxLength = 200) => {
  if (!text || typeof text !== 'string') return ''
  return text.replace(/[<>]/g, '').trim().substring(0, maxLength)
}

const validatePhone = (phone) => {
  if (!phone) return false
  const clean = phone.replace(/\D/g, '')
  return clean.length >= 10 && clean.length <= 11 && /^\d+$/.test(clean)
}

const validateCep = (cep) => {
  if (!cep) return false
  const clean = cep.replace(/\D/g, '')
  return clean.length === 8 && /^\d+$/.test(clean)
}

const validatePrice = (price) => {
  const num = parseFloat(price)
  return !isNaN(num) && num > 0 && num <= 99999.99
}

const validateQuantity = (qty, unit) => {
  if (qty === null || qty === undefined || isNaN(qty)) return false
  if (unit === 'kg') return qty > 0 && qty <= 9999.999
  return Number.isInteger(qty) && qty > 0 && qty <= 9999
}

const hashPassword = async (password) => {
  const msgBuffer = new TextEncoder().encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

const hashClientPassword = async (password, phone) => {
  const cleanPhone = (phone || '').toString().replace(/\D/g, '')
  const salt = `clickentregas_client_${cleanPhone}_sec_2026`
  const msgBuffer = new TextEncoder().encode(password + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

const SECURITY_QUESTIONS = [
  "Qual é o nome da sua mãe?",
  "Qual é a sua cor favorita?",
  "Qual foi o modelo do seu primeiro carro ou moto?",
  "Qual é a sua cidade natal?",
  "Qual é o nome do seu primeiro animal de estimação?",
  "Qual é o seu prato ou comida favorita?",
  "Qual é o nome da sua primeira escola?"
]

const normalizeAnswer = (text) => {
  if (!text || typeof text !== 'string') return ''
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

const parseCustomerSecurity = (customer) => {
  if (!customer) return customer
  let secQ = customer.security_question
  let secA = customer.security_answer_hash

  if ((!secQ || !secA) && customer.recovery_code && typeof customer.recovery_code === 'string') {
    if (customer.recovery_code.startsWith('SEC:')) {
      try {
        const parsed = JSON.parse(customer.recovery_code.slice(4))
        if (parsed.q) secQ = parsed.q
        if (parsed.a) secA = parsed.a
      } catch (err) {
        console.warn('Erro ao parsear recovery_code SEC:', err)
      }
    }
  }

  return {
    ...customer,
    security_question: secQ || customer.security_question || null,
    security_answer_hash: secA || customer.security_answer_hash || null
  }
}

const sanitizeErrorMessage = (err) => {
  console.error('[API ERROR]', err)
  if (!err) return 'Ocorreu um erro inesperado.'
  if (typeof err === 'string') return err
  if (err.message) return err.message
  if (err.details) return err.details
  return 'Ocorreu um erro inesperado. Por favor, tente novamente.'
}
function App() {
  const [configured, setConfigured] = useState(isSupabaseConfigured())
  const [initialSettingsLoading, setInitialSettingsLoading] = useState(isSupabaseConfigured())
  
  // Refs
  const fileInputRef = useRef(null)

  // Initialize User from LocalStorage to persist sessions
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('clickentregas_user')
    return saved ? JSON.parse(saved) : null
  })

  useEffect(() => {
    updateSupabaseHeaders()
  }, [user])

  // Initialize Page based on logged in user status or URL tracking param
  const [page, setPage] = useState(() => {
    const orderId = new URLSearchParams(window.location.search).get('pedido')
    if (orderId) return 'tracking'

    const saved = localStorage.getItem('clickentregas_user')
    const savedAdminPhone = localStorage.getItem('clickentregas_admin_phone') || ADMIN_PHONE
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed.isAdmin || parsed.phone === savedAdminPhone) {
        return 'admin'
      }
      return 'catalog'
    }
    return 'login'
  })

  // Admin Impersonation States (Admin placing orders for clients)
  const [isAdminImpersonating, setIsAdminImpersonating] = useState(() => {
    return localStorage.getItem('clickentregas_impersonating') === 'true'
  })
  const [adminProfile, setAdminProfile] = useState(() => {
    const savedAdmin = localStorage.getItem('clickentregas_admin_profile')
    return savedAdmin ? JSON.parse(savedAdmin) : null
  })

  const [adminTab, setAdminTab] = useState('orders') // orders, products, customers, settings
  const [clientTab, setClientTab] = useState('catalog') // catalog, orders (within client view)

  // User State
  const [phoneInput, setPhoneInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [isNewUser, setIsNewUser] = useState(false)
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  // Catalog State
  const [products, setProducts] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState(() => {
    try {
      const saved = localStorage.getItem('clickentregas_cart')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [showCartModal, setShowCartModal] = useState(false)

  // Persistir carrinho no localStorage para não perder ao recarregar a página
  useEffect(() => {
    try {
      if (cart && cart.length > 0) {
        localStorage.setItem('clickentregas_cart', JSON.stringify(cart))
      } else {
        localStorage.removeItem('clickentregas_cart')
      }
    } catch (e) {
      console.error('Erro ao persistir carrinho no localStorage:', e)
    }
  }, [cart])

  // Restaurar carrinho salvo no perfil caso o carrinho local esteja vazio
  useEffect(() => {
    if (user && user.active_cart && Array.isArray(user.active_cart) && user.active_cart.length > 0) {
      setCart((currentCart) => {
        if (currentCart && currentCart.length > 0) return currentCart
        return user.active_cart.map(item => ({
          product: {
            id: item.id || item.product_id,
            name: item.name,
            price: item.price,
            unit: item.unit,
            image_url: item.image_url,
            is_approximate: item.is_approximate
          },
          quantity: item.quantity
        }))
      })
    }
  }, [user?.id])

  // Client Orders History State
  const [clientOrders, setClientOrders] = useState([])
  const [loadingClientOrders, setLoadingClientOrders] = useState(false)

  // Checkout State (Pre-filled from persistent user state if available)
  const [cep, setCep] = useState(() => user?.cep || '')
  const [street, setStreet] = useState(() => user?.street || '')
  const [neighborhood, setNeighborhood] = useState(() => user?.neighborhood || '')
  const [city, setCity] = useState(() => user?.city || '')
  const [state, setState] = useState(() => user?.state || '')
  const [number, setNumber] = useState(() => user?.number || '')
  const [complement, setComplement] = useState(() => user?.complement || '')
  const [notes, setNotes] = useState('')
  const [cepLoading, setCepLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [createdOrderId, setCreatedOrderId] = useState('')

  useEffect(() => {
    if (user) {
      setCep(user.cep || '')
      setStreet(user.street || '')
      setNeighborhood(user.neighborhood || '')
      setCity(user.city || '')
      setState(user.state || '')
      setNumber(user.number || '')
      setComplement(user.complement || '')
    } else {
      setCep('')
      setStreet('')
      setNeighborhood('')
      setCity('')
      setState('')
      setNumber('')
      setComplement('')
    }
  }, [user])

  const [showEditProfileModal, setShowEditProfileModal] = useState(false)
  const [profileForm, setProfileForm] = useState({
    name: '',
    phone: '',
    cep: '',
    street: '',
    neighborhood: '',
    city: '',
    state: '',
    number: '',
    complement: ''
  })

  const [editingCustomer, setEditingCustomer] = useState(null)
  const [editingNicknameCustomer, setEditingNicknameCustomer] = useState(null)
  const [adminNicknameForm, setAdminNicknameForm] = useState('')
  const [adminCustomerForm, setAdminCustomerForm] = useState({
    name: '',
    phone: '',
    nickname: '',
    group_name: '',
    cep: '',
    street: '',
    neighborhood: '',
    city: '',
    state: '',
    number: '',
    complement: ''
  })

  // Admin State
  const [orders, setOrders] = useState([])
  const [adminProducts, setAdminProducts] = useState([])
  const [adminCustomers, setAdminCustomers] = useState([])
  const [whatsappTemplate, setWhatsappTemplate] = useState('')
  const [whatsappTemplateNoCharge, setWhatsappTemplateNoCharge] = useState('')
  const [whatsappAbandonedCartTemplate, setWhatsappAbandonedCartTemplate] = useState('')
  const [whatHappensNowText, setWhatHappensNowText] = useState('')
  const [pixMessageTemplate, setPixMessageTemplate] = useState('')
  const [smsApiKey, setSmsApiKey] = useState('textbelt')
  const [whatsappApiUrl, setWhatsappApiUrl] = useState('')
  const [whatsappApiToken, setWhatsappApiToken] = useState('')

  // Client Security & Password States
  const [clientPasswordInput, setClientPasswordInput] = useState('')
  const [clientPasswordConfirmInput, setClientPasswordConfirmInput] = useState('')
  const [showClientPassword, setShowClientPassword] = useState(false)
  const [showClientPasswordConfirm, setShowClientPasswordConfirm] = useState(false)
  const [securityQuestionInput, setSecurityQuestionInput] = useState(SECURITY_QUESTIONS[0])
  const [securityAnswerInput, setSecurityAnswerInput] = useState('')
  const [clientLoginPasswordInput, setClientLoginPasswordInput] = useState('')
  const [showClientLoginPassword, setShowClientLoginPassword] = useState(false)
  const [clientPasswordPromptNeeded, setClientPasswordPromptNeeded] = useState(false)
  const [clientLegacySetupNeeded, setClientLegacySetupNeeded] = useState(false)
  const [clientSecuritySetupNeeded, setClientSecuritySetupNeeded] = useState(false)
  const [clientFoundCustomer, setClientFoundCustomer] = useState(null)

  // Forgot Password / Recovery States (Security Question Verification)
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false)
  const [forgotPasswordStep, setForgotPasswordStep] = useState('answer') // 'answer' | 'new_password'
  const [forgotPasswordAnswerInput, setForgotPasswordAnswerInput] = useState('')
  const [forgotPasswordNewPassword, setForgotPasswordNewPassword] = useState('')
  const [forgotPasswordConfirmPassword, setForgotPasswordConfirmPassword] = useState('')
  const [showForgotNewPassword, setShowForgotNewPassword] = useState(false)
  const [showForgotConfirmPassword, setShowForgotConfirmPassword] = useState(false)

  // Change Password in Profile States
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false)
  const [currentPasswordInput, setCurrentPasswordInput] = useState('')
  const [newPasswordInput, setNewPasswordInput] = useState('')
  const [newPasswordConfirmInput, setNewPasswordConfirmInput] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showNewPasswordConfirm, setShowNewPasswordConfirm] = useState(false)
  const [showChangeSecurityQuestionModal, setShowChangeSecurityQuestionModal] = useState(false)
  const [profileSecurityQuestion, setProfileSecurityQuestion] = useState(SECURITY_QUESTIONS[0])
  const [profileSecurityAnswer, setProfileSecurityAnswer] = useState('')
  const [adminPhone, setAdminPhone] = useState(() => localStorage.getItem('clickentregas_admin_phone') || ADMIN_PHONE)
  const [adminName, setAdminName] = useState(() => localStorage.getItem('clickentregas_admin_name') || 'Bruno (Dono)')
  const [adminPasswordSetupNeeded, setAdminPasswordSetupNeeded] = useState(false)
  const [adminPasswordPromptNeeded, setAdminPasswordPromptNeeded] = useState(false)
  const [storedAdminPasswordHash, setStoredAdminPasswordHash] = useState('')
  const [adminPasswordInput, setAdminPasswordInput] = useState('')
  const [adminPasswordConfirmInput, setAdminPasswordConfirmInput] = useState('')
  const [showAdminPassword, setShowAdminPassword] = useState(false)
  const [showAdminConfirmPassword, setShowAdminConfirmPassword] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null) // null or product object
  const [showProductModal, setShowProductModal] = useState(false)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [productForm, setProductForm] = useState({ name: '', description: '', price: '', unit: 'unidade', is_approximate: false, image_url: '', is_active: true, stock: null })
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', nickname: '', group_name: '' })
  const [customerGroupFilter, setCustomerGroupFilter] = useState('all')
  const [adminOrderGroupFilter, setAdminOrderGroupFilter] = useState('all')
  const [couponCodeInput, setCouponCodeInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState(null)
  const [adminOrderDiscountInput, setAdminOrderDiscountInput] = useState('0')
  const [adminOrderDiscountType, setAdminOrderDiscountType] = useState('fixed') // 'fixed' | 'percentage'
  const [discountingOrder, setDiscountingOrder] = useState(null)
  const [discountInput, setDiscountInput] = useState('')
  const [discountType, setDiscountType] = useState('fixed') // 'fixed' | 'percentage'
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [selectedGroupCustomers, setSelectedGroupCustomers] = useState([])
  const [groupSearchQuery, setGroupSearchQuery] = useState('')
  const [adjustingOrder, setAdjustingOrder] = useState(null) // order object being adjusted
  const [deliveringOrder, setDeliveringOrder] = useState(null) // order object being marked as delivered
  const [adjustingQuantities, setAdjustingQuantities] = useState({}) // { orderItemId: quantity }
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminOrderSubTab, setAdminOrderSubTab] = useState('pending') // pending, delivered
  const [orderSearchQuery, setOrderSearchQuery] = useState('')
  const [adminOrderPaymentFilter, setAdminOrderPaymentFilter] = useState('all') // all, pending, paid
  const [clientOrderHistoryTab, setClientOrderHistoryTab] = useState('in_progress') // in_progress, awaiting_payment, paid
  const [mobileAdminMenuOpen, setMobileAdminMenuOpen] = useState(false) // Mobile admin tab navigation menu open state
  const [showItemReportModal, setShowItemReportModal] = useState(false)
  const [itemReportFilter, setItemReportFilter] = useState('current') // 'current' | 'pending' | 'assembled' | 'delivered' | 'all'
  const [itemReportCopied, setItemReportCopied] = useState(false)
  const [abandonedCartFilter, setAbandonedCartFilter] = useState('all') // 'all' | '15min'
  const [abandonedCartSearch, setAbandonedCartSearch] = useState('')
  
  // Weight Popup and Ratings States
  const [showWeightModal, setShowWeightModal] = useState(false)
  const [weightModalProduct, setWeightModalProduct] = useState(null)
  const [weightModalValue, setWeightModalValue] = useState('0.0')
  const [orderToEvaluate, setOrderToEvaluate] = useState(null)
  const [evaluationRating, setEvaluationRating] = useState(0)
  const [evaluationComment, setEvaluationComment] = useState('')
  const [hoveredStar, setHoveredStar] = useState(0)
  const [adminCoupons, setAdminCoupons] = useState([])
  const [showCouponModal, setShowCouponModal] = useState(false)
  const [editingCouponState, setEditingCouponState] = useState(null)
  const [couponForm, setCouponForm] = useState({
    code: '',
    discount_type: 'percentage',
    discount_value: '',
    max_uses: '',
    max_uses_per_client: '1',
    expires_at: '',
    is_active: true
  })
  // Tracking Page States
  const [trackingOrder, setTrackingOrder] = useState(null)
  const [trackingError, setTrackingError] = useState(null)
  const [trackingLoading, setTrackingLoading] = useState(false)

  // Dynamic brand customization states
  const [clientBrandName, setClientBrandName] = useState('ClickEntregas')
  const [clientBrandSlogan, setClientBrandSlogan] = useState('Seu pedido entregue com rapidez e segurança')
  const [clientBrandLogo, setClientBrandLogo] = useState('')
  const [clientBrandBanner, setClientBrandBanner] = useState('')
  const [clientColorTheme, setClientColorTheme] = useState('indigo') // indigo, emerald, amber, terracotta
  // Custom theme selector helper
  const getThemeClasses = (themeName) => {
    switch (themeName) {
      case 'emerald':
        return {
          bg: 'bg-emerald-600',
          hoverBg: 'hover:bg-emerald-700',
          text: 'text-emerald-700',
          hoverText: 'hover:text-emerald-800',
          border: 'border-emerald-600',
          focusBorder: 'focus:border-emerald-500',
          focusRing: 'focus:ring-emerald-500/20',
          lightBg: 'bg-emerald-50',
          lightText: 'text-emerald-900',
          lightBorder: 'border-emerald-200',
          lightHoverBg: 'hover:bg-emerald-100/50',
          badgeBg: 'bg-emerald-600',
          ringColor: 'ring-emerald-500',
          shadowColor: 'shadow-emerald-100',
          tintBg: 'bg-emerald-500/10',
          tintText: 'text-emerald-700',
          iconColor: 'text-emerald-600',
          accentText: 'text-emerald-600',
          accentBorder: 'border-emerald-500',
          gradientBg: 'bg-gradient-to-r from-emerald-600 to-teal-600',
          pageBg: 'bg-gradient-to-br from-emerald-50 via-emerald-100/10 to-teal-50/50',
          cardBg: 'bg-white border border-emerald-200 shadow-md shadow-emerald-50/30 hover:shadow-lg transition-all duration-300',
          headerBg: 'bg-white border-b border-emerald-200 shadow-xs shadow-emerald-50/10',
          inputBg: 'bg-emerald-50/30 border border-emerald-250 focus:bg-white focus:border-emerald-500'
        }
      case 'amber':
        return {
          bg: 'bg-amber-600',
          hoverBg: 'hover:bg-amber-700',
          text: 'text-amber-700',
          hoverText: 'hover:text-amber-800',
          border: 'border-amber-600',
          focusBorder: 'focus:border-amber-500',
          focusRing: 'focus:ring-amber-500/20',
          lightBg: 'bg-amber-50',
          lightText: 'text-amber-900',
          lightBorder: 'border-amber-200',
          lightHoverBg: 'hover:bg-amber-100/50',
          badgeBg: 'bg-amber-600',
          ringColor: 'ring-amber-500',
          shadowColor: 'shadow-amber-100',
          tintBg: 'bg-amber-500/10',
          tintText: 'text-amber-700',
          iconColor: 'text-amber-600',
          accentText: 'text-amber-600',
          accentBorder: 'border-amber-500',
          gradientBg: 'bg-gradient-to-r from-amber-600 to-orange-600',
          pageBg: 'bg-gradient-to-br from-amber-50 via-amber-100/10 to-orange-50/50',
          cardBg: 'bg-white border border-amber-200 shadow-md shadow-amber-100/30 hover:shadow-lg transition-all duration-300',
          headerBg: 'bg-white border-b border-amber-200 shadow-xs shadow-amber-50/10',
          inputBg: 'bg-amber-50/30 border border-amber-200 focus:bg-white focus:border-amber-500'
        }
      case 'terracotta':
        return {
          bg: 'bg-rose-700',
          hoverBg: 'hover:bg-rose-800',
          text: 'text-rose-700',
          hoverText: 'hover:text-rose-800',
          border: 'border-rose-700',
          focusBorder: 'focus:border-rose-600',
          focusRing: 'focus:ring-rose-700/20',
          lightBg: 'bg-rose-50',
          lightText: 'text-rose-900',
          lightBorder: 'border-rose-200',
          lightHoverBg: 'hover:bg-rose-100/50',
          badgeBg: 'bg-rose-600',
          ringColor: 'ring-rose-600',
          shadowColor: 'shadow-rose-100',
          tintBg: 'bg-rose-650/10',
          tintText: 'text-rose-700',
          iconColor: 'text-rose-600',
          accentText: 'text-rose-600',
          accentBorder: 'border-rose-500',
          gradientBg: 'bg-gradient-to-r from-rose-700 to-rose-500',
          pageBg: 'bg-gradient-to-br from-rose-50 via-rose-100/10 to-orange-50/50',
          cardBg: 'bg-white border border-rose-200 shadow-md shadow-rose-100/30 hover:shadow-lg transition-all duration-300',
          headerBg: 'bg-white border-b border-rose-200 shadow-xs shadow-rose-50/10',
          inputBg: 'bg-rose-50/30 border border-rose-200 focus:bg-white focus:border-rose-500'
        }
      case 'indigo':
      default:
        return {
          bg: 'bg-indigo-600',
          hoverBg: 'hover:bg-indigo-700',
          text: 'text-indigo-700',
          hoverText: 'hover:text-indigo-800',
          border: 'border-indigo-600',
          focusBorder: 'focus:border-indigo-500',
          focusRing: 'focus:ring-indigo-500/20',
          lightBg: 'bg-indigo-50',
          lightText: 'text-indigo-900',
          lightBorder: 'border-indigo-200',
          lightHoverBg: 'hover:bg-indigo-100/50',
          badgeBg: 'bg-indigo-600',
          ringColor: 'ring-indigo-500',
          shadowColor: 'shadow-indigo-100',
          tintBg: 'bg-indigo-500/10',
          tintText: 'text-indigo-750',
          iconColor: 'text-indigo-600',
          accentText: 'text-indigo-600',
          accentBorder: 'border-indigo-500',
          gradientBg: 'bg-gradient-to-r from-indigo-600 to-indigo-500',
          pageBg: 'bg-gradient-to-br from-indigo-50 via-indigo-100/10 to-blue-50/50',
          cardBg: 'bg-white border border-indigo-200 shadow-md shadow-indigo-100/30 hover:shadow-lg transition-all duration-300',
          headerBg: 'bg-white border-b border-indigo-200 shadow-xs shadow-indigo-50/10',
          inputBg: 'bg-indigo-50/30 border border-indigo-200 focus:bg-white focus:border-indigo-500'
        }
    }
  }

  const theme = getThemeClasses(clientColorTheme)
  
  // Custom unit quantity modal states
  const [showQtyModal, setShowQtyModal] = useState(false)
  const [qtyModalProduct, setQtyModalProduct] = useState(null)
  const [qtyModalValue, setQtyModalValue] = useState(1)
  
  // Custom chart hover state
  const [hoveredBar, setHoveredBar] = useState(null)
  
  // Brand setting refs
  const logoFileInputRef = useRef(null)
  const bannerFileInputRef = useRef(null)

  // Custom Modal state
  const [confirmModal, setConfirmModal] = useState({
    show: false,
    title: '',
    message: '',
    onConfirm: null,
    onCancel: null,
    confirmText: 'Confirmar',
    cancelText: 'Cancelar',
    isAlert: false
  })
  const [toasts, setToasts] = useState([])
  const [pixKey, setPixKey] = useState('')
  const [pixName, setPixName] = useState('')
  const [pixCity, setPixCity] = useState('SAO PAULO')
  const [pixQrCodeStatic, setPixQrCodeStatic] = useState('')
  const [pixType, setPixType] = useState('dynamic')
  const [pixEnabled, setPixEnabled] = useState(true)
  const [financeFilter, setFinanceFilter] = useState('7d')
  
  const pixFileInputRef = useRef(null)

  const showConfirm = (title, message, onConfirm, onCancel = null, confirmText = 'Confirmar', cancelText = 'Cancelar') => {
    setConfirmModal({
      show: true,
      title,
      message,
      onConfirm: () => {
        setConfirmModal(prev => ({ ...prev, show: false }))
        if (onConfirm) onConfirm()
      },
      onCancel: () => {
        setConfirmModal(prev => ({ ...prev, show: false }))
        if (onCancel) onCancel()
      },
      confirmText,
      cancelText,
      isAlert: false
    })
  }

  const showAlert = (title, message, onConfirm = null) => {
    setConfirmModal({
      show: true,
      title,
      message,
      onConfirm: () => {
        setConfirmModal(prev => ({ ...prev, show: false }))
        if (onConfirm) onConfirm()
      },
      onCancel: null,
      confirmText: 'OK',
      cancelText: '',
      isAlert: true
    })
  }

  const addToast = (message, type = 'success') => {
    const id = Date.now() + Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000);
  }

  const playNewOrderSound = () => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const playBeep = (freq, duration, delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
        
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + duration);
      };
      
      playBeep(523.25, 0.2, 0); // C5
      playBeep(659.25, 0.25, 0.1); // E5
      playBeep(783.99, 0.3, 0.2); // G5
    } catch (err) {
      console.error("Audio playback error:", err);
    }
  }

  const generatePixCopiaCola = ({ chave, beneficiario, cidade, valor, identificador = 'CLICKENTREGAS' }) => {
    if (!chave) return '';
    try {
      const cleanString = (str) => (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
      let cleanChave = chave.trim();
      const isEmail = cleanChave.includes('@');
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanChave);
      
      if (!isEmail && !isUuid) {
        cleanChave = cleanChave.replace(/[^0-9+]/g, '');
        if (/^\d{10,11}$/.test(cleanChave)) {
          cleanChave = '+55' + cleanChave;
        }
      }

      const cleanName = cleanString(beneficiario).substring(0, 25);
      const cleanCity = cleanString(cidade || 'SAO PAULO').substring(0, 15);
      const cleanId = cleanString(identificador).substring(0, 25);

      const formatField = (id, val) => {
        const len = val.length.toString().padStart(2, '0');
        return `${id}${len}${val}`;
      };

      let payload = '000201';
      const gui = 'br.gov.bcb.pix';
      const merchantAccount = formatField('00', gui) + formatField('01', cleanChave);
      payload += formatField('26', merchantAccount);
      payload += '52040000'; // MCC
      payload += '5303986';  // BRL Currency
      
      if (valor && parseFloat(valor) > 0) {
        const valStr = parseFloat(valor).toFixed(2);
        payload += formatField('54', valStr);
      }

      payload += '5802BR'; // Country
      payload += formatField('59', cleanName);
      payload += formatField('60', cleanCity);
      
      const additionalData = formatField('05', cleanId);
      payload += formatField('62', additionalData);
      payload += '6304'; // CRC16 indicator

      let crc = 0xFFFF;
      const polynomial = 0x1021;

      for (let i = 0; i < payload.length; i++) {
        const b = payload.charCodeAt(i);
        for (let j = 0; j < 8; j++) {
          const bit = ((b >> (7 - j) & 1) === 1);
          const c15 = ((crc >> 15 & 1) === 1);
          crc <<= 1;
          if (c15 ^ bit) {
            crc ^= polynomial;
          }
        }
      }

      crc &= 0xFFFF;
      const crcHex = crc.toString(16).toUpperCase().padStart(4, '0');
      return payload + crcHex;
    } catch (e) {
      console.error('Error generating Pix:', e);
      return chave;
    }
  }

  // useEffect hooks moved down below data load declarations to avoid ESLint hoisting issues

  // Load functions
  const loadProducts = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name', { ascending: true })
      
      if (error) throw error
      setProducts(data || [])
      setAdminProducts(data || [])
    } catch (err) {
      console.error('Erro ao carregar produtos:', err.message)
    } finally {
      setLoading(false)
    }
  }

  // Load Single Order details for tracking
  const loadTrackingOrder = async (orderId) => {
    if (!orderId) return
    try {
      setTrackingLoading(true)
      setTrackingError(null)
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (
            name,
            phone
          ),
          order_items (
            *,
            products (
              name,
              unit,
              image_url
            )
          )
        `)
        .eq('id', orderId)
        .single()

      if (error) throw error
      if (!data) {
        setTrackingError('Pedido não encontrado.')
      } else {
        setTrackingOrder(data)
      }
    } catch (err) {
      console.error('Erro ao carregar detalhes do pedido:', err.message)
      setTrackingError('Erro ao carregar os dados do pedido. Verifique o link ou tente novamente.')
    } finally {
      setTrackingLoading(false)
    }
  }

  const loadAdminOrders = async () => {
    try {
      setAdminLoading(true)
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (
            name,
            phone,
            nickname,
            group_name
          ),
          order_items (
            *,
            products (
              name,
              unit
            )
          )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      setOrders(data || [])
    } catch (err) {
      console.error('Erro ao carregar pedidos:', err.message)
    } finally {
      setAdminLoading(false)
    }
  }

  const loadAdminSettings = async () => {
    if (!isSupabaseConfigured() || !supabase) return
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
      
      if (error) throw error
      if (data) {
        const wt = data.find(item => item.key === 'whatsapp_template')
        if (wt) setWhatsappTemplate(wt.value)
        else setWhatsappTemplate('Olá {nome}! Seu pedido #{pedido_id} foi entregue. Total: R$ {total}. Agradecemos a preferência!')

        const wtnc = data.find(item => item.key === 'whatsapp_template_no_charge')
        if (wtnc) setWhatsappTemplateNoCharge(wtnc.value)
        else setWhatsappTemplateNoCharge('Olá {nome}! Seu pedido #{pedido_id} foi entregue. Agradecemos a preferência!')

        const wtac = data.find(item => item.key === 'whatsapp_abandoned_cart_template')
        if (wtac) setWhatsappAbandonedCartTemplate(wtac.value)
        else setWhatsappAbandonedCartTemplate('Olá {nome}! Tudo bem?\n\nVi que você separou alguns itens especiais no carrinho da {loja}:\n\n{itens}\n\n*Total Estimado: R$ {total}*\n\nGostaria de ajuda para finalizar seu pedido? Qualquer dúvida estou à disposição! 😊')

        const pk = data.find(item => item.key === 'pix_key')
        if (pk) setPixKey(pk.value || '')

        const pn = data.find(item => item.key === 'pix_name')
        if (pn) setPixName(pn.value || '')

        const pc = data.find(item => item.key === 'pix_city')
        if (pc) setPixCity(pc.value || 'SAO PAULO')

        const pqs = data.find(item => item.key === 'pix_qrcode_static')
        if (pqs) setPixQrCodeStatic(pqs.value || '')

        const pt = data.find(item => item.key === 'pix_type')
        if (pt) setPixType(pt.value || 'dynamic')

        const pe = data.find(item => item.key === 'pix_enabled')
        if (pe) setPixEnabled(pe.value === 'true')
        else setPixEnabled(true)

        const cbn = data.find(item => item.key === 'client_brand_name')
        if (cbn) setClientBrandName(cbn.value || 'ClickEntregas')

        const cbs = data.find(item => item.key === 'client_brand_slogan')
        if (cbs) setClientBrandSlogan(cbs.value || 'Seu pedido entregue com rapidez e segurança')

        const cbl = data.find(item => item.key === 'client_brand_logo')
        if (cbl) setClientBrandLogo(cbl.value || '')

        const cbb = data.find(item => item.key === 'client_brand_banner')
        if (cbb) setClientBrandBanner(cbb.value || '')

        const cct = data.find(item => item.key === 'client_color_theme')
        if (cct) setClientColorTheme(cct.value || 'indigo')

        const whnt = data.find(item => item.key === 'what_happens_now_text')
        if (whnt) setWhatHappensNowText(whnt.value)
        else setWhatHappensNowText(`O que acontece agora?\n\n1. O dono irá confirmar os itens do pedido.\n\n2. Caso haja itens fracionados (ex: queijo), eles serão pesados e o valor ajustado.\n\n3. Assim que o entregador sair, o cliente receberá uma notificação no WhatsApp.`)

        const pmt = data.find(item => item.key === 'pix_message_template')
        if (pmt) setPixMessageTemplate(pmt.value)
        else setPixMessageTemplate('Olá! Segue o link para pagamento do seu pedido #{pedido_id} via Pix no valor de R$ {total}. Link: {link_pagamento}')

        const sak = data.find(item => item.key === 'sms_api_key')
        if (sak) setSmsApiKey(sak.value || 'textbelt')

        const wau = data.find(item => item.key === 'whatsapp_api_url')
        if (wau) setWhatsappApiUrl(wau.value || '')

        const wat = data.find(item => item.key === 'whatsapp_api_token')
        if (wat) setWhatsappApiToken(wat.value || '')

        const ap = data.find(item => item.key === 'admin_phone')
        if (ap) {
          setAdminPhone(ap.value || ADMIN_PHONE)
          localStorage.setItem('clickentregas_admin_phone', ap.value || ADMIN_PHONE)
        }

        const an = data.find(item => item.key === 'admin_name')
        if (an) {
          setAdminName(an.value || 'Bruno (Dono)')
          localStorage.setItem('clickentregas_admin_name', an.value || 'Bruno (Dono)')
        }
      } else {
        setWhatsappTemplate('Olá {nome}! Seu pedido #{pedido_id} foi entregue. Total: R$ {total}. Agradecemos a preferência!')
        setWhatsappTemplateNoCharge('Olá {nome}! Seu pedido #{pedido_id} foi entregue. Agradecemos a preferência!')
        setWhatHappensNowText(`O que acontece agora?\n\n1. O dono irá confirmar os itens do pedido.\n\n2. Caso haja itens fracionados (ex: queijo), eles serão pesados e o valor ajustado.\n\n3. Assim que o entregador sair, o cliente receberá uma notificação no WhatsApp.`)
        setPixMessageTemplate('Olá! Segue o link para pagamento do seu pedido #{pedido_id} via Pix no valor de R$ {total}. Link: {link_pagamento}')
      }
    } catch (err) {
      console.error('Erro ao carregar configurações:', err.message)
    } finally {
      setInitialSettingsLoading(false)
    }
  }

  const loadAdminCustomers = async () => {
    try {
      setAdminLoading(true)
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('name', { ascending: true })

      if (error) throw error
      setAdminCustomers(data || [])
    } catch (err) {
      console.error('Erro ao carregar clientes:', err.message)
    } finally {
      setAdminLoading(false)
    }
  }

  const loadAdminCoupons = async () => {
    if (!configured) return
    try {
      const { data, error } = await supabase
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setAdminCoupons(data || [])
    } catch (err) {
      console.error('Erro ao carregar cupons:', err.message)
    }
  }

  const startEditCoupon = (coupon) => {
    setEditingCouponState(coupon)
    setCouponForm({
      code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: String(coupon.discount_value),
      max_uses: coupon.max_uses !== null ? String(coupon.max_uses) : '',
      max_uses_per_client: coupon.max_uses_per_client !== null ? String(coupon.max_uses_per_client) : '1',
      expires_at: coupon.expires_at ? coupon.expires_at.split('T')[0] : '',
      is_active: coupon.is_active
    })
    setShowCouponModal(true)
  }

  const deleteCoupon = (couponId) => {
    showConfirm(
      'Excluir Cupom',
      'Tem certeza de que deseja excluir este cupom permanentemente? Esta ação não pode ser desfeita.',
      async () => {
        setAdminLoading(true)
        try {
          const { error } = await supabase
            .from('coupons')
            .delete()
            .eq('id', couponId)

          if (error) throw error
          addToast('Cupom excluído com sucesso!', 'success')
          loadAdminCoupons()
        } catch (err) {
          showAlert('Erro', sanitizeErrorMessage(err))
        } finally {
          setAdminLoading(false)
        }
      }
    )
  }

  const handleSaveCoupon = async (e) => {
    e.preventDefault()
    if (!configured) return
    setAdminLoading(true)

    const code = couponForm.code.trim().toUpperCase()
    const discountVal = parseFloat(couponForm.discount_value)
    if (!code || isNaN(discountVal) || discountVal < 0) {
      showAlert('Erro', 'Por favor, insira valores válidos de cupom e desconto.')
      setAdminLoading(false)
      return
    }

    const maxUsesStr = couponForm.max_uses !== undefined && couponForm.max_uses !== null ? String(couponForm.max_uses).trim() : ''
    const maxUsesPerClientStr = couponForm.max_uses_per_client !== undefined && couponForm.max_uses_per_client !== null ? String(couponForm.max_uses_per_client).trim() : ''

    let expiresAtIso = null
    if (couponForm.expires_at && !isNaN(Date.parse(couponForm.expires_at))) {
      const dateOnly = couponForm.expires_at.includes('T') ? couponForm.expires_at.split('T')[0] : couponForm.expires_at
      expiresAtIso = new Date(dateOnly + 'T23:59:59').toISOString()
    }

    const payload = {
      code,
      discount_type: couponForm.discount_type,
      discount_value: discountVal,
      max_uses: maxUsesStr ? parseInt(maxUsesStr) : null,
      max_uses_per_client: maxUsesPerClientStr ? parseInt(maxUsesPerClientStr) : null,
      expires_at: expiresAtIso,
      is_active: couponForm.is_active
    }

    try {
      if (editingCouponState) {
        // Check if code already exists on other coupon
        const { data: existing, error: checkError } = await supabase
          .from('coupons')
          .select('id')
          .eq('code', code)
          .neq('id', editingCouponState.id)
          .maybeSingle()

        if (checkError) throw checkError
        if (existing) {
          showAlert('Erro', 'Este código de cupom já existe no sistema!')
          setAdminLoading(false)
          return
        }

        // Update
        const { error } = await supabase
          .from('coupons')
          .update(payload)
          .eq('id', editingCouponState.id)

        if (error) throw error
        addToast('Cupom atualizado com sucesso!', 'success')
      } else {
        // Check if code already exists
        const { data: existing, error: checkError } = await supabase
          .from('coupons')
          .select('id')
          .eq('code', code)
          .maybeSingle()

        if (checkError) throw checkError
        if (existing) {
          showAlert('Erro', 'Este código de cupom já existe no sistema!')
          setAdminLoading(false)
          return
        }

        // Create
        const { error } = await supabase
          .from('coupons')
          .insert([payload])

        if (error) throw error
        addToast('Cupom cadastrado com sucesso!', 'success')
      }

      setShowCouponModal(false)
      setEditingCouponState(null)
      loadAdminCoupons()
    } catch (err) {
      showAlert('Erro ao Salvar Cupom', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  const handleClearCustomerNotification = async (customerId) => {
    setAdminCustomers(prev => 
      prev.map(c => c.id === customerId ? { ...c, profile_updated_pending: false } : c)
    )
    try {
      await supabase
        .from('customers')
        .update({ profile_updated_pending: false })
        .eq('id', customerId)
    } catch (err) {
      console.error('Erro ao limpar notificação do cliente:', err)
    }
  }

  // Listen to configuration changes
  useEffect(() => {
    if (configured) {
      Promise.resolve().then(() => {
        loadAdminSettings()
      })
    }
  }, [configured])

  // Detect URL parameter 'pedido' for tracking page
  useEffect(() => {
    if (!configured) return
    const orderId = new URLSearchParams(window.location.search).get('pedido')
    if (orderId) {
      Promise.resolve().then(() => {
        loadTrackingOrder(orderId)
      })
    }
  }, [configured])

  // Load products for catalog
  useEffect(() => {
    if (configured && (page === 'catalog' || page === 'admin')) {
      Promise.resolve().then(() => {
        loadProducts()
      })
    }
  }, [page, configured])

  // Load admin data
  useEffect(() => {
    if (configured && page === 'admin') {
      Promise.resolve().then(() => {
        loadAdminOrders()
        loadAdminSettings()
        loadAdminCustomers()
        loadAdminCoupons()
      })
    }
  }, [page, configured, adminTab])

  // Realtime subscription for new orders (Admin)
  useEffect(() => {
    if (!configured || page !== 'admin' || !supabase) return

    const channel = supabase
      .channel('orders_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        Promise.resolve().then(() => {
          loadAdminOrders()
        })
        if (payload.eventType === 'INSERT') {
          playNewOrderSound()
          const newOrder = payload.new
          addToast(`Novo pedido #${newOrder.id.substring(0, 8).toUpperCase()} recebido! Total: R$ ${parseFloat(newOrder.total_price || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'info')
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [page, configured])

  // Load Client Orders History
  const loadClientOrders = async () => {
    if (!user || !user.id) return
    try {
      setLoadingClientOrders(true)
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            products (
              name,
              unit
            )
          )
        `)
        .eq('customer_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setClientOrders(data || [])

      // Auto-open rating popup if the absolute most recent order is delivered and has no rating
      if (data && data.length > 0) {
        const lastOrder = data[0]
        if (lastOrder.status === 'delivered' && lastOrder.rating === null) {
          const dismissedRatings = JSON.parse(localStorage.getItem('dismissed_ratings') || '[]')
          if (!dismissedRatings.includes(lastOrder.id)) {
            setOrderToEvaluate(lastOrder)
            setEvaluationRating(0)
            setEvaluationComment('')
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar seus pedidos:', err.message)
    } finally {
      setLoadingClientOrders(false)
    }
  }

  const submitRating = async (orderId, rating, comment) => {
    if (rating === 0) {
      showAlert('Avaliação', 'Por favor, selecione uma nota de 1 a 5 estrelas.')
      return
    }

    const existingOrder = clientOrders.find(o => o.id === orderId)
    if (existingOrder && existingOrder.rating !== null && existingOrder.rating !== undefined) {
      showAlert('Avaliação', 'Você já avaliou este pedido.')
      setOrderToEvaluate(null)
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase
        .from('orders')
        .update({ rating, rating_comment: comment })
        .eq('id', orderId)

      if (error) throw error
      
      // Update local state
      setClientOrders(prev => prev.map(o => o.id === orderId ? { ...o, rating, rating_comment: comment } : o))
      
      // Save to dismissed ratings in localStorage so it never prompts again
      const dismissed = JSON.parse(localStorage.getItem('dismissed_ratings') || '[]')
      if (!dismissed.includes(orderId)) {
        dismissed.push(orderId)
        localStorage.setItem('dismissed_ratings', JSON.stringify(dismissed))
      }

      setOrderToEvaluate(null)
      setEvaluationRating(0)
      setEvaluationComment('')
      showAlert('Sucesso', 'Muito obrigado pela sua avaliação!')
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Format Phone Input
  const handlePhoneChange = (e) => {
    const value = e.target.value.replace(/\D/g, '')
    setPhoneInput(value)
  }

  const getFormattedPhone = (raw) => {
    if (!raw) return ''
    const r = raw.replace(/\D/g, '')
    if (r.length <= 2) return `(${r}`
    if (r.length <= 6) return `(${r.substring(0, 2)}) ${r.substring(2)}`
    if (r.length <= 10) return `(${r.substring(0, 2)}) ${r.substring(2, 6)}-${r.substring(6)}`
    return `(${r.substring(0, 2)}) ${r.substring(2, 7)}-${r.substring(7, 11)}`
  }

  // Format CEP Input (00000-000)
  const getFormattedCep = (raw) => {
    if (!raw) return ''
    const r = raw.replace(/\D/g, '')
    if (r.length <= 5) return r
    return `${r.substring(0, 5)}-${r.substring(5, 8)}`
  }

  const formatQuantity = (qty, unit) => {
    if (qty === null || qty === undefined) return ''
    if (unit === 'kg') {
      return qty.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg'
    }
    return qty + ' ' + (unit || 'un') + '(s)'
  }

  // Login handler
  const handleLogin = async (e) => {
    e.preventDefault()
    if (!configured) return
    setAuthError('')
    setLoading(true)

    const cleanPhone = phoneInput.replace(/\D/g, '')
    
    // Check if admin
    if (cleanPhone === adminPhone) {
      try {
        const { data: isSet, error } = await supabase.rpc('is_admin_password_set')

        if (error) throw error

        if (!isSet) {
          // Password not setup yet
          setAdminPasswordSetupNeeded(true)
        } else {
          // Password prompt needed
          setAdminPasswordPromptNeeded(true)
        }
      } catch (err) {
        setAuthError('Erro ao verificar segurança do administrador: ' + err.message)
      } finally {
        setLoading(false)
      }
      return
    }

    if (!validatePhone(cleanPhone)) {
      setAuthError('Por favor, insira um número de telefone válido com DDD.')
      setLoading(false)
      return
    }

    try {
      if (supabase) {
        supabase.rest.headers.set('x-client-phone', cleanPhone)
      }
      // Find customer
      const { data: rawCustomer, error } = await supabase
        .from('customers')
        .select('*')
        .eq('phone', cleanPhone)
        .maybeSingle()

      if (error) throw error

      const customer = parseCustomerSecurity(rawCustomer)

      if (customer) {
        // If customer already has a password hash, prompt for password
        if (customer.password_hash) {
          setClientFoundCustomer(customer)
          setClientLoginPasswordInput('')
          setClientPasswordPromptNeeded(true)
          setLoading(false)
          return
        }

        // Customer exists (legacy without password) - Offer creation of initial password
        setClientFoundCustomer(customer)
        setClientPasswordInput('')
        setClientPasswordConfirmInput('')
        setClientLegacySetupNeeded(true)
        setLoading(false)
        return
      } else {
        // New customer, ask for name and password
        setIsNewUser(true)
        setClientPasswordInput('')
        setClientPasswordConfirmInput('')
      }
    } catch (err) {
      setAuthError(sanitizeErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Legacy Customer Password Setup Handler
  const handleSaveLegacyCustomerPassword = async (e) => {
    e.preventDefault()
    if (!clientFoundCustomer) return
    setAuthError('')
    setLoading(true)

    if (!clientPasswordInput || clientPasswordInput.length < 4) {
      setAuthError('A nova senha deve ter no mínimo 4 caracteres.')
      setLoading(false)
      return
    }

    if (clientPasswordInput !== clientPasswordConfirmInput) {
      setAuthError('A confirmação não coincide com a nova senha digitada.')
      setLoading(false)
      return
    }

    if (!securityAnswerInput.trim()) {
      setAuthError('Por favor, informe a resposta para a sua pergunta secreta.')
      setLoading(false)
      return
    }

    try {
      const cleanPhone = clientFoundCustomer.phone.replace(/\D/g, '')
      const passwordHash = await hashClientPassword(clientPasswordInput, cleanPhone)
      const answerHash = await hashClientPassword(normalizeAnswer(securityAnswerInput), cleanPhone)
      const secPayload = 'SEC:' + JSON.stringify({ q: securityQuestionInput, a: answerHash })

      if (supabase) {
        supabase.rest.headers.set('x-client-phone', cleanPhone)
      }

      const { error } = await supabase
        .from('customers')
        .update({ 
          password_hash: passwordHash,
          recovery_code: secPayload
        })
        .eq('phone', cleanPhone)

      if (error) {
        console.warn('Aviso ao salvar senha e pergunta de segurança no Supabase:', error.message)
      }

      const userObject = { 
        ...clientFoundCustomer, 
        password_hash: passwordHash, 
        security_question: securityQuestionInput,
        security_answer_hash: answerHash,
        recovery_code: secPayload,
        isAdmin: false 
      }
      setUser(userObject)
      localStorage.setItem('clickentregas_user', JSON.stringify(userObject))

      setCep(clientFoundCustomer.cep || '')
      setStreet(clientFoundCustomer.street || '')
      setNeighborhood(clientFoundCustomer.neighborhood || '')
      setCity(clientFoundCustomer.city || '')
      setState(clientFoundCustomer.state || '')
      setNumber(clientFoundCustomer.number || '')
      setComplement(clientFoundCustomer.complement || '')

      setClientLegacySetupNeeded(false)
      setClientPasswordInput('')
      setClientPasswordConfirmInput('')
      setSecurityAnswerInput('')
      setClientTab('catalog')
      setPage('catalog')
      addToast('Senha e pergunta de segurança cadastradas!', 'success')
    } catch (err) {
      setAuthError(sanitizeErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Client Password Login handler
  const handleClientPasswordLogin = async (e) => {
    e.preventDefault()
    if (!clientFoundCustomer) return
    setAuthError('')
    setLoading(true)

    try {
      if (!clientLoginPasswordInput) {
        setAuthError('Por favor, insira sua senha de acesso.')
        setLoading(false)
        return
      }

      const inputHash = await hashClientPassword(clientLoginPasswordInput, clientFoundCustomer.phone)
      if (inputHash !== clientFoundCustomer.password_hash) {
        setAuthError('Senha incorreta. Verifique a senha ou use "Esqueci minha senha".')
        setLoading(false)
        return
      }

      const customer = parseCustomerSecurity(clientFoundCustomer)
      const userObject = { ...customer, isAdmin: false }
      setUser(userObject)
      localStorage.setItem('clickentregas_user', JSON.stringify(userObject))

      setCep(customer.cep || '')
      setStreet(customer.street || '')
      setNeighborhood(customer.neighborhood || '')
      setCity(customer.city || '')
      setState(customer.state || '')
      setNumber(customer.number || '')
      setComplement(customer.complement || '')

      // If customer does not have a security question registered yet, prompt them to configure it now
      if (!customer.security_question || !customer.security_answer_hash) {
        setClientPasswordPromptNeeded(false)
        setClientSecuritySetupNeeded(true)
        setLoading(false)
        return
      }

      setClientPasswordPromptNeeded(false)
      setClientLoginPasswordInput('')
      setClientTab('catalog')
      setPage('catalog')
    } catch (err) {
      setAuthError(sanitizeErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Save Security Question for existing customer on next login
  const handleSaveClientSecurityQuestion = async (e) => {
    e.preventDefault()
    if (!user && !clientFoundCustomer) return
    const target = user || clientFoundCustomer
    const cleanPhone = (target.phone || phoneInput).replace(/\D/g, '')

    if (!securityAnswerInput.trim()) {
      setAuthError('Por favor, informe a resposta para a sua pergunta secreta.')
      return
    }

    setLoading(true)
    setAuthError('')
    try {
      const answerHash = await hashClientPassword(normalizeAnswer(securityAnswerInput), cleanPhone)
      const secPayload = 'SEC:' + JSON.stringify({ q: securityQuestionInput, a: answerHash })

      if (supabase) {
        supabase.rest.headers.set('x-client-phone', cleanPhone)
      }

      const { data, error } = await supabase
        .from('customers')
        .update({
          recovery_code: secPayload
        })
        .eq('phone', cleanPhone)
        .select()
        .single()

      if (error) {
        console.warn('Aviso ao salvar pergunta de segurança no Supabase:', error.message)
      }

      const updatedUser = { 
        ...target, 
        ...(data || {}), 
        security_question: securityQuestionInput, 
        security_answer_hash: answerHash, 
        recovery_code: secPayload,
        isAdmin: false 
      }
      setUser(updatedUser)
      setClientFoundCustomer(updatedUser)
      localStorage.setItem('clickentregas_user', JSON.stringify(updatedUser))

      setClientSecuritySetupNeeded(false)
      setSecurityAnswerInput('')
      setClientPasswordPromptNeeded(false)
      setClientLoginPasswordInput('')
      setClientTab('catalog')
      setPage('catalog')
      addToast('Pergunta secreta cadastrada com sucesso!', 'success')
    } catch (err) {
      setAuthError(sanitizeErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Register handler
  const handleRegister = async (e) => {
    e.preventDefault()
    if (!configured) return
    setAuthError('')
    setLoading(true)

    const nameCleaned = sanitizeText(nameInput, 100)
    if (!nameCleaned) {
      setAuthError('Por favor, informe seu nome.')
      setLoading(false)
      return
    }

    if (!clientPasswordInput || clientPasswordInput.length < 4) {
      setAuthError('A senha deve ter no mínimo 4 caracteres.')
      setLoading(false)
      return
    }

    if (clientPasswordInput !== clientPasswordConfirmInput) {
      setAuthError('A confirmação da senha não coincide com a nova senha digitada.')
      setLoading(false)
      return
    }

    if (!securityAnswerInput.trim()) {
      setAuthError('Por favor, responda a pergunta de segurança para recuperação da conta.')
      setLoading(false)
      return
    }

    const cleanPhone = phoneInput.replace(/\D/g, '')

    try {
      if (supabase) {
        supabase.rest.headers.set('x-client-phone', cleanPhone)
      }

      const passwordHash = await hashClientPassword(clientPasswordInput, cleanPhone)
      const answerHash = await hashClientPassword(normalizeAnswer(securityAnswerInput), cleanPhone)
      const secPayload = 'SEC:' + JSON.stringify({ q: securityQuestionInput, a: answerHash })

      const { data, error } = await supabase
        .from('customers')
        .insert([{ 
          name: nameCleaned, 
          phone: cleanPhone,
          password_hash: passwordHash,
          recovery_code: secPayload
        }])
        .select()
        .single()

      if (error) throw error

      const userObject = { 
        ...data, 
        security_question: securityQuestionInput, 
        security_answer_hash: answerHash, 
        recovery_code: secPayload,
        isAdmin: false 
      }
      setUser(userObject)
      localStorage.setItem('clickentregas_user', JSON.stringify(userObject))
      
      setIsNewUser(false)
      setClientPasswordInput('')
      setClientPasswordConfirmInput('')
      setSecurityAnswerInput('')
      setClientTab('catalog')
      setPage('catalog')
      addToast('Cadastro realizado com sucesso!', 'success')
    } catch (err) {
      setAuthError(sanitizeErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Forgot Password / Recovery Handler: Security Question Verification
  const handleStartForgotPassword = async () => {
    const clean = (clientFoundCustomer?.phone || phoneInput).replace(/\D/g, '')
    if (!clean || !validatePhone(clean)) {
      setAuthError('Por favor, insira um número de telefone válido com DDD para recuperar a senha.')
      return
    }

    setLoading(true)
    setAuthError('')
    try {
      if (supabase) {
        supabase.rest.headers.set('x-client-phone', clean)
      }

      // Sempre busca os dados mais atualizados do cliente no banco para garantir a pergunta exata
      const { data: rawCust, error: findErr } = await supabase
        .from('customers')
        .select('*')
        .eq('phone', clean)
        .maybeSingle()

      if (findErr) throw findErr
      if (!rawCust) {
        setAuthError('Nenhum cadastro encontrado para o telefone ' + getFormattedPhone(clean) + '.')
        setLoading(false)
        return
      }

      const foundCust = parseCustomerSecurity(rawCust)
      setClientFoundCustomer(foundCust)
      setForgotPasswordStep('answer')
      setForgotPasswordAnswerInput('')
      setForgotPasswordNewPassword('')
      setForgotPasswordConfirmPassword('')
      setShowForgotPasswordModal(true)
    } catch (err) {
      setAuthError(sanitizeErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleVerifySecurityAnswer = async (e) => {
    e.preventDefault()
    if (!clientFoundCustomer) return
    const targetPhone = clientFoundCustomer.phone.replace(/\D/g, '')

    if (!forgotPasswordAnswerInput.trim()) {
      showAlert('Campo Obrigatório', 'Por favor, informe a resposta para validação.')
      return
    }

    if (clientFoundCustomer.security_answer_hash) {
      const inputHash = await hashClientPassword(normalizeAnswer(forgotPasswordAnswerInput), targetPhone)
      if (inputHash !== clientFoundCustomer.security_answer_hash) {
        showAlert('Resposta Incorreta', 'A resposta informada para a pergunta secreta está incorreta. Verifique e tente novamente.')
        return
      }
    } else {
      // Caso cliente legado não tenha cadastrado pergunta ainda, valida o nome completo cadastrado
      const inputNorm = normalizeAnswer(forgotPasswordAnswerInput)
      const nameNorm = normalizeAnswer(clientFoundCustomer.name || '')
      if (!inputNorm || (inputNorm !== nameNorm && !nameNorm.includes(inputNorm))) {
        showAlert('Nome Incorreto', 'O nome digitado não confere com o cadastro da conta. Tente novamente.')
        return
      }
    }

    setForgotPasswordStep('new_password')
  }

  const handleConfirmResetPassword = async (e) => {
    e.preventDefault()
    setAuthError('')

    if (!forgotPasswordNewPassword || forgotPasswordNewPassword.length < 4) {
      showAlert('Senha Curta', 'A nova senha deve ter no mínimo 4 caracteres.')
      return
    }

    if (forgotPasswordNewPassword !== forgotPasswordConfirmPassword) {
      showAlert('Senhas Não Coincidem', 'A confirmação de senha não coincide com a nova senha digitada.')
      return
    }

    setLoading(true)
    const targetPhone = clientFoundCustomer?.phone || phoneInput.replace(/\D/g, '')
    try {
      const newHash = await hashClientPassword(forgotPasswordNewPassword, targetPhone)
      if (supabase) {
        supabase.rest.headers.set('x-client-phone', targetPhone)
      }

      const { data, error } = await supabase
        .from('customers')
        .update({
          password_hash: newHash,
          recovery_code: null,
          recovery_expires: null
        })
        .eq('phone', targetPhone)
        .select()
        .single()

      if (error) throw error

      const userObject = { ...(data || clientFoundCustomer), password_hash: newHash, isAdmin: false }
      setUser(userObject)
      localStorage.setItem('clickentregas_user', JSON.stringify(userObject))

      setShowForgotPasswordModal(false)
      setClientPasswordPromptNeeded(false)
      setClientLoginPasswordInput('')
      setClientTab('catalog')
      setPage('catalog')
      addToast('Senha redefinida com sucesso!', 'success')
    } catch (err) {
      showAlert('Erro ao Redefinir Senha', sanitizeErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  // Change Password in Profile Handler
  const handleChangePasswordInProfile = async (e) => {
    e.preventDefault()
    if (!user) return

    if (user.password_hash) {
      const currentHash = await hashClientPassword(currentPasswordInput, user.phone)
      if (currentHash !== user.password_hash) {
        showAlert('Senha Atual Incorreta', 'A senha atual digitada está incorreta.')
        return
      }
    }

    if (!newPasswordInput || newPasswordInput.length < 4) {
      showAlert('Senha Curta', 'A nova senha deve ter no mínimo 4 caracteres.')
      return
    }

    if (newPasswordInput !== newPasswordConfirmInput) {
      showAlert('Senhas Não Coincidem', 'A confirmação não coincide com a nova senha digitada.')
      return
    }

    setAdminLoading(true)
    try {
      const newHash = await hashClientPassword(newPasswordInput, user.phone)
      if (supabase) {
        supabase.rest.headers.set('x-client-phone', user.phone)
      }

      const { error } = await supabase
        .from('customers')
        .update({ password_hash: newHash })
        .eq('id', user.id)

      if (error) throw error

      const updatedUser = { ...user, password_hash: newHash }
      setUser(updatedUser)
      localStorage.setItem('clickentregas_user', JSON.stringify(updatedUser))

      setShowChangePasswordModal(false)
      setCurrentPasswordInput('')
      setNewPasswordInput('')
      setNewPasswordConfirmInput('')
      addToast('Senha alterada com sucesso!', 'success')
    } catch (err) {
      showAlert('Erro ao Alterar Senha', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  // Change Security Question in Profile Handler
  const handleChangeSecurityQuestionInProfile = async (e) => {
    e.preventDefault()
    if (!user) return
    const cleanPhone = (user.phone || '').replace(/\D/g, '')

    if (!profileSecurityAnswer.trim()) {
      showAlert('Campo Obrigatório', 'Por favor, informe a resposta para a sua nova pergunta secreta.')
      return
    }

    setAdminLoading(true)
    try {
      const answerHash = await hashClientPassword(normalizeAnswer(profileSecurityAnswer), cleanPhone)
      const secPayload = 'SEC:' + JSON.stringify({ q: profileSecurityQuestion, a: answerHash })

      if (supabase) {
        supabase.rest.headers.set('x-client-phone', cleanPhone)
      }

      const { data, error } = await supabase
        .from('customers')
        .update({ recovery_code: secPayload })
        .eq('phone', cleanPhone)
        .select()
        .single()

      if (error) throw error

      const updatedUser = { 
        ...user, 
        ...(data || {}), 
        security_question: profileSecurityQuestion, 
        security_answer_hash: answerHash, 
        recovery_code: secPayload 
      }
      setUser(updatedUser)
      localStorage.setItem('clickentregas_user', JSON.stringify(updatedUser))

      setShowChangeSecurityQuestionModal(false)
      setProfileSecurityAnswer('')
      addToast('Pergunta secreta alterada com sucesso!', 'success')
    } catch (err) {
      showAlert('Erro ao Alterar Pergunta Secreta', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  const handleSaveAdminPassword = async (e) => {
    e.preventDefault()
    setAuthError('')
    if (adminPasswordInput.length < 6) {
      setAuthError('A senha do administrador deve ter pelo menos 6 caracteres.')
      return
    }
    if (adminPasswordInput !== adminPasswordConfirmInput) {
      setAuthError('As senhas não coincidem.')
      return
    }

    setLoading(true)
    try {
      const hash = await hashPassword(adminPasswordInput)
      const { data: success, error } = await supabase.rpc('set_admin_password', { new_hash: hash })

      if (error) throw error
      if (!success) {
        throw new Error('A senha do administrador já foi definida e não pode ser reescrita.')
      }

      localStorage.setItem('clickentregas_admin_hash', hash)
      const adminUser = { name: adminName, phone: adminPhone, isAdmin: true }
      setUser(adminUser)
      localStorage.setItem('clickentregas_user', JSON.stringify(adminUser))
      
      setAdminPasswordSetupNeeded(false)
      setAdminPasswordInput('')
      setAdminPasswordConfirmInput('')
      setPage('admin')
      addToast('Senha do administrador definida e salva com sucesso!', 'success')
    } catch (err) {
      setAuthError('Erro ao salvar senha do administrador: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyAdminPassword = async (e) => {
    e.preventDefault()
    setAuthError('')
    if (!adminPasswordInput) return

    setLoading(true)
    try {
      const hash = await hashPassword(adminPasswordInput)
      const { data: isValid, error } = await supabase.rpc('verify_admin_password', { password_hash: hash })

      if (error) throw error

      if (isValid) {
        localStorage.setItem('clickentregas_admin_hash', hash)
        const adminUser = { name: adminName, phone: adminPhone, isAdmin: true }
        setUser(adminUser)
        localStorage.setItem('clickentregas_user', JSON.stringify(adminUser))
        
        setAdminPasswordPromptNeeded(false)
        setAdminPasswordInput('')
        setPage('admin')
        addToast('Acesso concedido!', 'success')
      } else {
        setAuthError('Senha incorreta! Tente novamente.')
      }
    } catch (err) {
      setAuthError('Erro ao verificar senha: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  // CEP Lookup
  const handleCepChange = async (e) => {
    const rawValue = e.target.value.replace(/\D/g, '')
    setCep(rawValue)

    if (rawValue.length === 8) {
      setCepLoading(true)
      setCheckoutError('')
      try {
        const response = await fetch(`https://viacep.com.br/ws/${rawValue}/json/`)
        const data = await response.json()
        
        if (data.erro) {
          setCheckoutError('CEP não encontrado.')
        } else {
          setStreet(data.logradouro || '')
          setNeighborhood(data.bairro || '')
          setCity(data.localidade || '')
          setState(data.uf || '')
        }
      } catch (err) {
        console.error('Erro ao buscar CEP:', err)
        setCheckoutError('Erro ao buscar o CEP. Preencha os campos manualmente.')
      } finally {
        setCepLoading(false)
      }
    }
  }

  // Cart operations
  const addToCart = (product, qty = 1) => {
    const existing = cart.find(item => item.product.id === product.id)
    const currentQty = existing ? existing.quantity : 0
    const addedQty = qty
    if (product.stock !== null && product.stock !== undefined && (currentQty + addedQty) > product.stock) {
      showAlert('Estoque Insuficiente', `Desculpe, temos apenas ${product.stock} ${product.unit}(s) de ${product.name} em estoque.`)
      return false
    }

    setCart((prevCart) => {
      const ex = prevCart.find(item => item.product.id === product.id)
      if (ex) {
        return prevCart.map(item => 
          item.product.id === product.id 
            ? { ...item, quantity: parseFloat((item.quantity + addedQty).toFixed(3)) }
            : item
        )
      }
      return [...prevCart, { product, quantity: addedQty }]
    })
    return true
  }

  const handleWeightConfirm = () => {
    if (!weightModalProduct) return
    const parsedWeight = parseFloat(parseFloat(weightModalValue.replace(',', '.')).toFixed(3))
    if (isNaN(parsedWeight) || parsedWeight <= 0) {
      showAlert('Valor Inválido', 'Por favor, insira um peso válido maior que zero.')
      return
    }

    const existing = cart.find(item => item.product.id === weightModalProduct.id)
    const currentQty = existing ? existing.quantity : 0
    if (weightModalProduct.stock !== null && weightModalProduct.stock !== undefined && (currentQty + parsedWeight) > weightModalProduct.stock) {
      showAlert('Estoque Insuficiente', `Desculpe, temos apenas ${weightModalProduct.stock} ${weightModalProduct.unit}(s) de ${weightModalProduct.name} em estoque.`)
      return
    }
    
    // Add to cart
    setCart((prevCart) => {
      const ex = prevCart.find(item => item.product.id === weightModalProduct.id)
      if (ex) {
        return prevCart.map(item => 
          item.product.id === weightModalProduct.id 
            ? { ...item, quantity: parseFloat((item.quantity + parsedWeight).toFixed(3)) }
            : item
        )
      }
      return [...prevCart, { product: weightModalProduct, quantity: parsedWeight }]
    })
    
    // Reset and close
    setShowWeightModal(false)
    setWeightModalProduct(null)
    setWeightModalValue('0.0')
  }

  const handleQtyModalConfirm = () => {
    if (!qtyModalProduct) return
    const parsedQty = parseInt(qtyModalValue)
    if (isNaN(parsedQty) || parsedQty <= 0) {
      showAlert('Quantidade Inválida', 'Por favor, insira uma quantidade válida maior que zero.')
      return
    }

    const success = addToCart(qtyModalProduct, parsedQty)
    if (success) {
      setShowQtyModal(false)
      setQtyModalProduct(null)
      setQtyModalValue(1)
    }
  }

  const updateCartQuantity = (productId, change) => {
    const item = cart.find(i => i.product.id === productId)
    if (item && item.product.stock !== null && item.product.stock !== undefined && change > 0) {
      const step = item.product.unit === 'kg' ? 0.1 : 1
      if ((item.quantity + step) > item.product.stock) {
        showAlert('Estoque Insuficiente', `Desculpe, temos apenas ${item.product.stock} ${item.product.unit}(s) de ${item.product.name} em estoque.`)
        return
      }
    }

    setCart((prevCart) => {
      return prevCart.map(item => {
        if (item.product.id === productId) {
          const step = item.product.unit === 'kg' ? 0.1 : 1
          const newQty = Math.max(step, item.quantity + (change * step))
          return { ...item, quantity: item.product.unit === 'kg' ? parseFloat(newQty.toFixed(3)) : parseFloat(newQty.toFixed(2)) }
        }
        return item
      })
    })
  }

  const removeFromCart = (productId) => {
    setCart((prevCart) => prevCart.filter(item => item.product.id !== productId))
  }

  const getCartTotal = () => {
    return parseFloat(cart.reduce((total, item) => total + (item.product.price * item.quantity), 0).toFixed(2))
  }

  const hasApproximateInCart = () => {
    return cart.some(item => item.product.is_approximate)
  }

  // Sincronização automática do carrinho do cliente com o Supabase para rastreamento de carrinhos abandonados
  useEffect(() => {
    if (!configured || !user?.phone || user.isAdmin || isAdminImpersonating) return

    const syncCartToDatabase = async () => {
      try {
        updateSupabaseHeaders()
        if (cart.length > 0) {
          const serializedCart = cart.map(item => ({
            id: item.product.id,
            name: item.product.name,
            price: item.product.price,
            unit: item.product.unit,
            quantity: item.quantity,
            image_url: item.product.image_url,
            is_approximate: item.product.is_approximate
          }))
          const { error } = await supabase
            .from('customers')
            .update({ 
              active_cart: serializedCart, 
              cart_updated_at: new Date().toISOString() 
            })
            .eq('phone', user.phone)
          
          if (error) {
            console.warn('Supabase active_cart sync notice:', error.message)
          }
        } else {
          await supabase
            .from('customers')
            .update({ 
              active_cart: null, 
              cart_updated_at: null 
            })
            .eq('phone', user.phone)
        }
      } catch (err) {
        console.warn('Sincronização de carrinho:', err.message)
      }
    }

    const timer = setTimeout(syncCartToDatabase, 400)
    return () => clearTimeout(timer)
  }, [cart, user?.phone, configured, isAdminImpersonating])

  const handleContactAbandonedCartCustomer = (customer) => {
    if (!customer || !customer.phone || !customer.active_cart) return
    const itemsList = customer.active_cart.map(i => `• ${i.quantity}x ${i.name}`).join('\n')
    const totalEst = customer.active_cart.reduce((tot, i) => tot + (i.price * i.quantity), 0)
    const formattedTotal = totalEst.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const firstName = customer.name ? customer.name.split(' ')[0] : 'Cliente'
    
    let template = whatsappAbandonedCartTemplate || `Olá {nome}! Tudo bem?\n\nVi que você separou alguns itens especiais no carrinho da {loja}:\n\n{itens}\n\n*Total Estimado: R$ {total}*\n\nGostaria de ajuda para finalizar seu pedido? Qualquer dúvida estou à disposição! 😊`
    
    const msg = template
      .replace(/{nome}/g, firstName)
      .replace(/{loja}/g, clientBrandName || 'ClickEntregas')
      .replace(/{itens}/g, itemsList)
      .replace(/{total}/g, formattedTotal)
      .replace(/{telefone}/g, getFormattedPhone(customer.phone))

    const cleanPhone = customer.phone.replace(/\D/g, '')
    window.open(`https://wa.me/55${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const openEditProfileModal = () => {
    setProfileForm({
      name: user?.name || '',
      phone: user?.phone || '',
      cep: user?.cep || '',
      street: user?.street || '',
      neighborhood: user?.neighborhood || '',
      city: user?.city || '',
      state: user?.state || '',
      number: user?.number || '',
      complement: user?.complement || ''
    })
    setShowEditProfileModal(true)
  }

  const handleSaveProfile = async (e) => {
    if (e) e.preventDefault()
    if (!configured) return
    setAdminLoading(true)

    const cleanPhone = profileForm.phone.replace(/\D/g, '')
    const cleanCep = profileForm.cep.replace(/\D/g, '')
    const nameCleaned = sanitizeText(profileForm.name, 100)

    if (!nameCleaned) {
      showAlert('Erro de Validação', 'Por favor, insira seu nome.')
      setAdminLoading(false)
      return
    }

    if (!validatePhone(cleanPhone)) {
      showAlert('Erro de Validação', 'Por favor, insira um telefone válido com DDD.')
      setAdminLoading(false)
      return
    }

    if (profileForm.cep && !validateCep(cleanCep)) {
      showAlert('Erro de Validação', 'Por favor, insira um CEP válido de 8 dígitos.')
      setAdminLoading(false)
      return
    }

    try {
      const streetSanitized = sanitizeText(profileForm.street, 200)
      const neighborhoodSanitized = sanitizeText(profileForm.neighborhood, 100)
      const citySanitized = sanitizeText(profileForm.city, 100)
      const stateSanitized = sanitizeText(profileForm.state, 2).toUpperCase()
      const numberSanitized = sanitizeText(profileForm.number, 20)
      const complementSanitized = sanitizeText(profileForm.complement, 100)

      const { error } = await supabase
        .from('customers')
        .update({
          name: nameCleaned,
          phone: cleanPhone,
          cep: cleanCep,
          street: streetSanitized,
          neighborhood: neighborhoodSanitized,
          city: citySanitized,
          state: stateSanitized,
          number: numberSanitized,
          complement: complementSanitized,
          profile_updated_pending: true
        })
        .eq('id', user.id)

      if (error) throw error

      const updatedUser = {
        ...user,
        name: nameCleaned,
        phone: cleanPhone,
        cep: cleanCep,
        street: streetSanitized,
        neighborhood: neighborhoodSanitized,
        city: citySanitized,
        state: stateSanitized,
        number: numberSanitized,
        complement: complementSanitized
      }
      setUser(updatedUser)
      localStorage.setItem('clickentregas_user', JSON.stringify(updatedUser))

      setCep(profileForm.cep)
      setStreet(profileForm.street)
      setNeighborhood(profileForm.neighborhood)
      setCity(profileForm.city)
      setState(profileForm.state)
      setNumber(profileForm.number)
      setComplement(profileForm.complement)

      setShowEditProfileModal(false)
      addToast('Cadastro atualizado com sucesso!', 'success')
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  const handleProfileCepChange = async (e) => {
    const rawValue = e.target.value.replace(/\D/g, '')
    setProfileForm(prev => ({ ...prev, cep: rawValue }))
    
    if (rawValue.length === 8) {
      setCepLoading(true)
      try {
        const response = await fetch(`https://viacep.com.br/ws/${rawValue}/json/`)
        const data = await response.json()
        if (!data.erro) {
          setProfileForm(prev => ({
            ...prev,
            street: data.logradouro || '',
            neighborhood: data.bairro || '',
            city: data.localidade || '',
            state: data.uf || ''
          }))
        }
      } catch (err) {
        console.error('Erro ao buscar CEP no perfil:', err)
      } finally {
        setCepLoading(false)
      }
    }
  }

  // Checkout submit
  const handleCheckoutSubmit = async (e) => {
    e.preventDefault()
    if (!configured) return
    setCheckoutError('')
    setLoading(true)

    if (!street || !neighborhood || !city || !state || !number) {
      setCheckoutError('Por favor, preencha todos os campos obrigatórios do endereço.')
      setLoading(false)
      return
    }

    const fullAddress = `${street}, Nº ${number}${complement ? ` - ${complement}` : ''}, ${neighborhood}, ${city}-${state} (CEP: ${getFormattedCep(cep)})`
    const subtotal = getCartTotal()
    const discount = appliedCoupon ? appliedCoupon.discountAmount : 0
    const finalTotal = Math.max(0, subtotal - discount)

    try {
      // 1. Update customer profile with latest address in Supabase
      await supabase
        .from('customers')
        .update({
          cep, street, neighborhood, city, state, number, complement
        })
        .eq('id', user.id)

      // 2. Update local state and persistent storage
      const updatedUser = {
        ...user,
        cep, street, neighborhood, city, state, number, complement
      }
      setUser(updatedUser)
      localStorage.setItem('clickentregas_user', JSON.stringify(updatedUser))

      // 3. Create Order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert([{
          customer_id: user.id,
          status: 'pending',
          total_price: finalTotal,
          delivery_address: fullAddress,
          notes: notes.trim() || null,
          coupon_code: appliedCoupon ? appliedCoupon.code : null,
          discount: discount
        }])
        .select()
        .single()

      if (orderError) throw orderError

      // 4. Create Order Items
      const orderItemsToInsert = cart.map(item => ({
        order_id: order.id,
        product_id: item.product.id,
        quantity_requested: item.quantity,
        quantity_final: item.product.is_approximate ? null : item.quantity,
        price_unit: item.product.price,
        price_final: item.product.is_approximate ? null : parseFloat((item.product.price * item.quantity).toFixed(2)),
        is_approximate: item.product.is_approximate
      }))

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItemsToInsert)

      if (itemsError) throw itemsError

      // Decrement product stock in database
      for (const item of cart) {
        if (item.product.stock !== null && item.product.stock !== undefined) {
          const { data: success, error: rpcError } = await supabase
            .rpc('decrement_stock', { p_product_id: item.product.id, p_qty: item.quantity })
          
          if (rpcError) throw rpcError
          if (!success) {
            throw new Error(`Desculpe, o estoque do produto "${item.product.name}" acabou de se esgotar no banco de dados.`)
          }
        }
      }

      // Clear active_cart on customer in Supabase
      if (user?.phone) {
        supabase
          .from('customers')
          .update({ active_cart: null, cart_updated_at: null })
          .eq('phone', user.phone)
          .then(() => {})
          .catch(() => {})
      }

      setCreatedOrderId(order.id)
      setCart([])
      localStorage.removeItem('clickentregas_cart')
      if (isAdminImpersonating) {
        loadAdminCustomers()
      }
      setAppliedCoupon(null)
      setCouponCodeInput('')
      setPage('success')
    } catch (err) {
      setCheckoutError(sanitizeErrorMessage(err))
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleApplyCoupon = async () => {
    const code = couponCodeInput.trim().toUpperCase()
    if (!code) return

    setLoading(true)
    try {
      // 1. Fetch coupon details from Supabase
      const { data: coupon, error } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', code)
        .eq('is_active', true)
        .maybeSingle()

      if (error) throw error
      
      if (!coupon) {
        addToast('Cupom inválido ou inativo!', 'error')
        setLoading(false)
        return
      }

      // Check expiration
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        addToast('Este cupom já expirou!', 'error')
        setLoading(false)
        return
      }

      // 2. Check total coupon usages
      let totalUsesVal = 0
      if (coupon.max_uses !== null) {
        const { count: totalUses, error: countError } = await supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('coupon_code', code)
          .neq('status', 'cancelled')

        if (countError) {
          console.warn('Erro ao verificar total de usos do cupom (RLS ou permissão):', countError.message)
        } else {
          totalUsesVal = totalUses || 0
        }
        
        if (totalUsesVal >= coupon.max_uses) {
          addToast('Este cupom atingiu o limite de usos!', 'error')
          setLoading(false)
          return
        }
      }

      // 3. Check coupon usages by this customer
      let clientUsesVal = 0
      if (user && user.id) {
        const { count: clientUses, error: clientCountError } = await supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', user.id)
          .eq('coupon_code', code)
          .neq('status', 'cancelled')

        if (clientCountError) {
          console.warn('Erro ao verificar usos do cupom pelo cliente:', clientCountError.message)
        } else {
          clientUsesVal = clientUses || 0
        }
      }

      if (clientUsesVal >= (coupon.max_uses_per_client || 1)) {
        addToast('Você já utilizou este cupom!', 'error')
        setLoading(false)
        return
      }

      // Calculate discount amount
      const subtotal = getCartTotal()
      let discountAmount = 0
      if (coupon.discount_type === 'percentage') {
        discountAmount = subtotal * (coupon.discount_value / 100)
      } else {
        discountAmount = Math.min(subtotal, coupon.discount_value)
      }

      setAppliedCoupon({
        code: coupon.code,
        discountAmount: discountAmount,
        discountType: coupon.discount_type,
        discountValue: coupon.discount_value
      })

      addToast(`Cupom ${code} aplicado!`, 'success')
    } catch (err) {
      console.error('Erro ao validar cupom:', err)
      addToast(`Erro ao validar cupom: ${err.message || err}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Local Image Upload & Compress to Base64
  const handleImageFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const maxW = 400
        const maxH = 400
        
        // Square center crop logic
        const size = Math.min(img.width, img.height)
        canvas.width = maxW
        canvas.height = maxH
        const ctx = canvas.getContext('2d')
        
        ctx.drawImage(
          img,
          (img.width - size) / 2,
          (img.height - size) / 2,
          size,
          size,
          0,
          0,
          maxW,
          maxH
        )

        // Compress to JPEG (0.75 quality)
        const base64Data = canvas.toDataURL('image/jpeg', 0.75)
        setProductForm(prev => ({
          ...prev,
          image_url: base64Data
        }))
      }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
  }

  // Impersonate (Place order on behalf of client)
  const handleImpersonate = (customer) => {
    showConfirm(
      'Fazer Pedido por Cliente',
      `Deseja fazer um pedido em nome de ${customer.name}? Você será redirecionado para o cardápio do cliente.`,
      () => {
        setAdminProfile(user) // Save current admin user (Bruno)
        localStorage.setItem('clickentregas_admin_profile', JSON.stringify(user))
        
        setIsAdminImpersonating(true)
        localStorage.setItem('clickentregas_impersonating', 'true')
        
        setUser(customer) // Set current user to selected customer
        localStorage.setItem('clickentregas_user', JSON.stringify(customer))
        
        setPage('catalog') // Redirect to client catalog
        addToast(`Entrou no modo de simulação de ${customer.name}`, 'success')
      }
    )
  }

  const handleStopImpersonating = () => {
    if (!adminProfile) {
      handleLogout()
      return
    }

    setUser(adminProfile)
    localStorage.setItem('clickentregas_user', JSON.stringify(adminProfile))
    
    setIsAdminImpersonating(false)
    localStorage.removeItem('clickentregas_impersonating')
    
    setAdminProfile(null)
    localStorage.removeItem('clickentregas_admin_profile')

    setCart([])
    setPage('admin')
  }

  // Admin: Save customer
  const handleSaveCustomer = async (e) => {
    e.preventDefault()
    if (!configured) return
    setAdminLoading(true)
    
    const cleanPhone = customerForm.phone.replace(/\D/g, '')
    if (cleanPhone.length < 10) {
      showAlert('Telefone Inválido', 'Por favor, insira um número de telefone válido com DDD.')
      setAdminLoading(false)
      return
    }

    try {
      // Check if phone already exists
      const { data: existing, error: existError } = await supabase
        .from('customers')
        .select('id')
        .eq('phone', cleanPhone)
        .maybeSingle()
      
      if (existError) throw existError
      if (existing) {
        showAlert('Erro', 'Este número de telefone já está cadastrado!')
        setAdminLoading(false)
        return
      }

      const { error } = await supabase
        .from('customers')
        .insert([{ 
          name: customerForm.name.trim(), 
          phone: cleanPhone,
          nickname: customerForm.nickname ? customerForm.nickname.trim() : null,
          group_name: customerForm.group_name ? customerForm.group_name.trim() : null
        }])
      
      if (error) throw error

      setShowCustomerModal(false)
      setCustomerForm({ name: '', phone: '', nickname: '', group_name: '' })
      loadAdminCustomers()
      addToast('Cliente cadastrado com sucesso!', 'success')
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  const handleCreateGroup = async (e) => {
    if (e) e.preventDefault()
    if (!configured) return
    const name = newGroupName.trim()
    if (!name) {
      showAlert('Erro', 'Por favor, insira o nome do grupo.')
      return
    }
    if (selectedGroupCustomers.length === 0) {
      showAlert('Erro', 'Por favor, selecione pelo menos um cliente para adicionar ao grupo.')
      return
    }
    setAdminLoading(true)
    try {
      const { error } = await supabase
        .from('customers')
        .update({ group_name: name })
        .in('id', selectedGroupCustomers)

      if (error) throw error

      addToast(`Grupo "${name}" criado e clientes associados!`, 'success')
      setShowCreateGroupModal(false)
      setNewGroupName('')
      setSelectedGroupCustomers([])
      loadAdminCustomers()
    } catch (err) {
      showAlert('Erro ao criar grupo', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  // Admin: Save product
  const handleSaveProduct = async (e) => {
    e.preventDefault()
    if (!configured) return
    setAdminLoading(true)

    const data = {
      name: productForm.name,
      description: productForm.description || null,
      price: parseFloat(parseFloat(productForm.price).toFixed(2)),
      unit: productForm.unit,
      is_approximate: productForm.is_approximate,
      image_url: productForm.image_url || null,
      is_active: productForm.is_active,
      stock: productForm.stock
    }

    try {
      if (editingProduct) {
        // Update
        const { error } = await supabase
          .from('products')
          .update(data)
          .eq('id', editingProduct.id)
        if (error) throw error
        addToast('Produto atualizado com sucesso!', 'success')
      } else {
        // Insert
        const { error } = await supabase
          .from('products')
          .insert([data])
        if (error) throw error
        addToast('Produto criado com sucesso!', 'success')
      }

      setShowProductModal(false)
      setEditingProduct(null)
      setProductForm({ name: '', description: '', price: '', unit: 'unidade', is_approximate: false, image_url: '', is_active: true, stock: null })
      loadProducts()
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  const startEditProduct = (product) => {
    setEditingProduct(product)
    setProductForm({
      name: product.name,
      description: product.description || '',
      price: product.price.toString(),
      unit: product.unit,
      is_approximate: product.is_approximate,
      image_url: product.image_url || '',
      is_active: product.is_active,
      stock: product.stock !== undefined ? product.stock : null
    })
    setShowProductModal(true)
  }

  const deleteProduct = async (id) => {
    showConfirm(
      'Excluir Produto',
      'Deseja realmente excluir este produto?',
      async () => {
        setAdminLoading(true)
        try {
          const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', id)
          if (error) throw error
          loadProducts()
          addToast('Produto excluído com sucesso!', 'success')
        } catch (err) {
          showAlert('Erro ao Excluir', sanitizeErrorMessage(err))
        } finally {
          setAdminLoading(false)
        }
      }
    )
  }

  const deleteOrder = async (orderId) => {
    showConfirm(
      'Excluir Pedido',
      'Deseja realmente excluir este pedido? Esta ação é irreversível.',
      async () => {
        setAdminLoading(true)
        try {
          // 1. Delete order items first
          const { error: itemsError } = await supabase
            .from('order_items')
            .delete()
            .eq('order_id', orderId)
          if (itemsError) throw itemsError

          // 2. Delete the order
          const { error: orderError } = await supabase
            .from('orders')
            .delete()
            .eq('id', orderId)
          if (orderError) throw orderError

          // Reload orders list
          loadAdminOrders()
          addToast('Pedido excluído com sucesso!', 'success')
        } catch (err) {
          showAlert('Erro ao Excluir', sanitizeErrorMessage(err))
        } finally {
          setAdminLoading(false)
        }
      }
    )
  }

  const deleteCustomer = async (customerId) => {
    showConfirm(
      'Excluir Cliente',
      'Deseja realmente excluir este cliente? Esta ação apagará o cadastro e todos os pedidos deste cliente e não poderá ser desfeita.',
      async () => {
        setAdminLoading(true)
        try {
          // 1. Get all order IDs for this customer
          const { data: customerOrders, error: fetchOrdersError } = await supabase
            .from('orders')
            .select('id')
            .eq('customer_id', customerId)
          if (fetchOrdersError) throw fetchOrdersError

          if (customerOrders && customerOrders.length > 0) {
            const orderIds = customerOrders.map(o => o.id)
            
            // 2. Delete all order items for these orders
            const { error: itemsError } = await supabase
              .from('order_items')
              .delete()
              .in('order_id', orderIds)
            if (itemsError) throw itemsError

            // 3. Delete all orders
            const { error: ordersError } = await supabase
              .from('orders')
              .delete()
              .in('id', orderIds)
            if (ordersError) throw ordersError
          }

          // 4. Delete the customer
          const { error: customerError } = await supabase
            .from('customers')
            .delete()
            .eq('id', customerId)
          if (customerError) throw customerError

          loadAdminCustomers()
          showAlert('Sucesso', 'Cliente e seus históricos excluídos com sucesso.')
        } catch (err) {
          showAlert('Erro ao Excluir', sanitizeErrorMessage(err))
        } finally {
          setAdminLoading(false)
        }
      }
    )
  }

  const startEditCustomer = (customer) => {
    setEditingCustomer(customer)
    setAdminCustomerForm({
      name: customer.name || '',
      phone: customer.phone || '',
      cep: customer.cep || '',
      street: customer.street || '',
      neighborhood: customer.neighborhood || '',
      city: customer.city || '',
      state: customer.state || '',
      number: customer.number || '',
      complement: customer.complement || '',
      group_name: customer.group_name || ''
    })
  }

  const handleAdminSaveCustomer = async (e) => {
    if (e) e.preventDefault()
    if (!configured || !editingCustomer) return
    setAdminLoading(true)
    try {
      const { error } = await supabase
        .from('customers')
        .update({
          name: adminCustomerForm.name,
          phone: adminCustomerForm.phone,
          cep: adminCustomerForm.cep,
          street: adminCustomerForm.street,
          neighborhood: adminCustomerForm.neighborhood,
          city: adminCustomerForm.city,
          state: adminCustomerForm.state,
          number: adminCustomerForm.number,
          complement: adminCustomerForm.complement,
          group_name: adminCustomerForm.group_name ? adminCustomerForm.group_name.trim() : null,
          profile_updated_pending: false 
        })
        .eq('id', editingCustomer.id)

      if (error) throw error

      addToast('Cadastro do cliente atualizado com sucesso!', 'success')
      setEditingCustomer(null)
      loadAdminCustomers()
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  const startEditNickname = (customer) => {
    setEditingNicknameCustomer(customer)
    setAdminNicknameForm(customer.nickname || '')
  }

  const handleAdminSaveNickname = async (e) => {
    if (e) e.preventDefault()
    if (!configured || !editingNicknameCustomer) return
    setAdminLoading(true)
    try {
      const { error } = await supabase
        .from('customers')
        .update({
          nickname: adminNicknameForm.trim() || null
        })
        .eq('id', editingNicknameCustomer.id)

      if (error) throw error

      addToast('Apelido do cliente atualizado com sucesso!', 'success')
      setEditingNicknameCustomer(null)
      setAdminNicknameForm('')
      loadAdminCustomers()
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  const handleAdminCustomerCepChange = async (e) => {
    const rawValue = e.target.value.replace(/\D/g, '')
    setAdminCustomerForm(prev => ({ ...prev, cep: rawValue }))
    
    if (rawValue.length === 8) {
      setCepLoading(true)
      try {
        const response = await fetch(`https://viacep.com.br/ws/${rawValue}/json/`)
        const data = await response.json()
        if (!data.erro) {
          setAdminCustomerForm(prev => ({
            ...prev,
            street: data.logradouro || '',
            neighborhood: data.bairro || '',
            city: data.localidade || '',
            state: data.uf || ''
          }))
        }
      } catch (err) {
        console.error('Erro ao buscar CEP no perfil admin:', err)
      } finally {
        setCepLoading(false)
      }
    }
  }

  // Admin: Save settings
  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault()
    if (!configured) return
    setAdminLoading(true)
    try {
      const { error: error1 } = await supabase
        .from('settings')
        .upsert({ key: 'whatsapp_template', value: whatsappTemplate, updated_at: new Date() })
      if (error1) throw error1

      const { error: error1nc } = await supabase
        .from('settings')
        .upsert({ key: 'whatsapp_template_no_charge', value: whatsappTemplateNoCharge, updated_at: new Date() })
      if (error1nc) throw error1nc

      const { error: error1ac } = await supabase
        .from('settings')
        .upsert({ key: 'whatsapp_abandoned_cart_template', value: whatsappAbandonedCartTemplate, updated_at: new Date() })
      if (error1ac) throw error1ac

      const { error: error2 } = await supabase
        .from('settings')
        .upsert({ key: 'pix_key', value: pixKey, updated_at: new Date() })
      if (error2) throw error2

      const { error: error3 } = await supabase
        .from('settings')
        .upsert({ key: 'pix_name', value: pixName, updated_at: new Date() })
      if (error3) throw error3

      const { error: error4 } = await supabase
        .from('settings')
        .upsert({ key: 'pix_city', value: pixCity, updated_at: new Date() })
      if (error4) throw error4

      const { error: error5 } = await supabase
        .from('settings')
        .upsert({ key: 'pix_qrcode_static', value: pixQrCodeStatic, updated_at: new Date() })
      if (error5) throw error5

      const { error: error6 } = await supabase
        .from('settings')
        .upsert({ key: 'pix_type', value: pixType, updated_at: new Date() })
      if (error6) throw error6

      const { error: error7 } = await supabase
        .from('settings')
        .upsert({ key: 'pix_enabled', value: pixEnabled ? 'true' : 'false', updated_at: new Date() })
      if (error7) throw error7

      const { error: error8 } = await supabase
        .from('settings')
        .upsert({ key: 'what_happens_now_text', value: whatHappensNowText, updated_at: new Date() })
      if (error8) throw error8

      const { error: errorSms } = await supabase
        .from('settings')
        .upsert({ key: 'sms_api_key', value: smsApiKey, updated_at: new Date() })
      if (errorSms) throw errorSms

      const { error: errorWau } = await supabase
        .from('settings')
        .upsert({ key: 'whatsapp_api_url', value: whatsappApiUrl, updated_at: new Date() })
      if (errorWau) throw errorWau

      const { error: errorWat } = await supabase
        .from('settings')
        .upsert({ key: 'whatsapp_api_token', value: whatsappApiToken, updated_at: new Date() })
      if (errorWat) throw errorWat

      const { error: error9 } = await supabase
        .from('settings')
        .upsert({ key: 'pix_message_template', value: pixMessageTemplate, updated_at: new Date() })
      if (error9) throw error9

      showAlert('Sucesso', 'Configurações salvas com sucesso!')
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  const handleSaveAdminProfile = async (e) => {
    if (e) e.preventDefault()
    if (!configured) return
    setAdminLoading(true)
    try {
      const { error: errorPhone } = await supabase
        .from('settings')
        .upsert({ key: 'admin_phone', value: adminPhone, updated_at: new Date() }, { onConflict: 'key' })
      if (errorPhone) throw errorPhone

      const { error: errorName } = await supabase
        .from('settings')
        .upsert({ key: 'admin_name', value: adminName, updated_at: new Date() }, { onConflict: 'key' })
      if (errorName) throw errorName

      localStorage.setItem('clickentregas_admin_phone', adminPhone)
      localStorage.setItem('clickentregas_admin_name', adminName)

      const currentUser = JSON.parse(localStorage.getItem('clickentregas_user') || '{}')
      if (currentUser && currentUser.isAdmin) {
        const updatedUser = { ...currentUser, name: adminName, phone: adminPhone }
        setUser(updatedUser)
        localStorage.setItem('clickentregas_user', JSON.stringify(updatedUser))
      }

      addToast('Perfil do administrador atualizado com sucesso!', 'success')
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  // Image helper to compress Base64 uploads
  const compressAndSetImage = (file, callback) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        const maxDim = 800;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const base64 = canvas.toDataURL('image/jpeg', 0.7);
        callback(base64);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0]
    if (file) {
      compressAndSetImage(file, (base64) => {
        setClientBrandLogo(base64)
      })
    }
  }

  const handleBannerUpload = (e) => {
    const file = e.target.files[0]
    if (file) {
      compressAndSetImage(file, (base64) => {
        setClientBrandBanner(base64)
      })
    }
  }

  const handleSaveCustomization = async (e) => {
    if (e) e.preventDefault()
    if (!configured) return
    setAdminLoading(true)
    try {
      const { error: error1 } = await supabase
        .from('settings')
        .upsert({ key: 'client_brand_name', value: clientBrandName, updated_at: new Date() })
      if (error1) throw error1

      const { error: error2 } = await supabase
        .from('settings')
        .upsert({ key: 'client_brand_slogan', value: clientBrandSlogan, updated_at: new Date() })
      if (error2) throw error2

      const { error: error3 } = await supabase
        .from('settings')
        .upsert({ key: 'client_brand_logo', value: clientBrandLogo, updated_at: new Date() })
      if (error3) throw error3

      const { error: error4 } = await supabase
        .from('settings')
        .upsert({ key: 'client_brand_banner', value: clientBrandBanner, updated_at: new Date() })
      if (error4) throw error4

      const { error: error5 } = await supabase
        .from('settings')
        .upsert({ key: 'client_color_theme', value: clientColorTheme, updated_at: new Date() })
      if (error5) throw error5

      showAlert('Sucesso', 'Customizações da página salvas com sucesso!')
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  // Admin: Adjust weights modal trigger
  const startAdjustingOrder = (order) => {
    setAdjustingOrder(order)
    const initialQty = {}
    order.order_items.forEach(item => {
      const val = item.quantity_final !== null ? item.quantity_final : item.quantity_requested
      initialQty[item.id] = item.is_approximate ? parseFloat(parseFloat(val).toFixed(3)) : val
    })
    setAdjustingQuantities(initialQty)
    setAdminOrderDiscountInput(String(order.discount || 0))
    setAdminOrderDiscountType('fixed')
  }

  const handleAdjustQtyChange = (itemId, val) => {
    setAdjustingQuantities(prev => ({
      ...prev,
      [itemId]: val // keep as string to allow decimal typing
    }))
  }
  const saveOrderAdjustments = async () => {
    if (!configured || !adjustingOrder) return
    setAdminLoading(true)

    try {
      let newTotal = 0

      // Update each item in the order
      for (const item of adjustingOrder.order_items) {
        const rawQty = adjustingQuantities[item.id]
        const finalQty = item.is_approximate ? parseFloat(parseFloat(rawQty).toFixed(3)) : parseFloat(rawQty)
        const finalPrice = parseFloat((finalQty * item.price_unit).toFixed(2))
        newTotal += finalPrice

        const { error } = await supabase
          .from('order_items')
          .update({
            quantity_final: finalQty,
            price_final: finalPrice
          })
          .eq('id', item.id)

        if (error) throw error
      }

      const discountInputVal = parseFloat(adminOrderDiscountInput) || 0
      const calculatedDiscount = parseFloat((adminOrderDiscountType === 'percentage'
        ? newTotal * (discountInputVal / 100)
        : discountInputVal).toFixed(2))

      const finalTotalPrice = parseFloat(Math.max(0, newTotal - calculatedDiscount).toFixed(2))

      // Update order total and discount
      const { error: orderError } = await supabase
        .from('orders')
        .update({
          discount: calculatedDiscount,
          total_price: finalTotalPrice
        })
        .eq('id', adjustingOrder.id)

      if (orderError) throw orderError

      setAdjustingOrder(null)
      loadAdminOrders()
      addToast('Ajustes salvos com sucesso!', 'success')
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  const startDiscountingOrder = (order) => {
    setDiscountingOrder(order)
    setDiscountInput(String(order.discount || 0))
    setDiscountType('fixed')
  }

  const saveOrderDiscount = async () => {
    if (!configured || !discountingOrder) return
    setAdminLoading(true)
    try {
      const subtotal = discountingOrder.order_items.reduce((total, item) => {
        const price = item.price_final !== null ? item.price_final : (item.price_unit * item.quantity_requested)
        return total + price
      }, 0)

      const discountVal = parseFloat(discountInput) || 0
      const calculatedDiscount = parseFloat((discountType === 'percentage'
        ? subtotal * (discountVal / 100)
        : discountVal).toFixed(2))

      const finalTotalPrice = parseFloat(Math.max(0, subtotal - calculatedDiscount).toFixed(2))

      const { error } = await supabase
        .from('orders')
        .update({
          discount: calculatedDiscount,
          total_price: finalTotalPrice
        })
        .eq('id', discountingOrder.id)

      if (error) throw error

      setDiscountingOrder(null)
      loadAdminOrders()
      addToast('Desconto aplicado com sucesso!', 'success')
    } catch (err) {
      showAlert('Erro ao aplicar desconto', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  // WhatsApp link generator & sender
  const sendWhatsAppMessage = (order, includeCharge = true) => {
    let pixMessage = ''
    if (includeCharge && pixEnabled && pixKey) {
      const pixCopiaCola = pixType === 'dynamic' ? generatePixCopiaCola({
        chave: pixKey,
        beneficiario: pixName || 'ClickEntregas Beneficiário',
        cidade: pixCity || 'SAO PAULO',
        valor: order.total_price
      }) : '';

      pixMessage = pixMessageTemplate
        .replace(/{pedido_id}/g, order.id.substring(0, 8).toUpperCase())
        .replace(/R\$\s*{total}/g, `*R$ ${order.total_price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`)
        .replace(/{total}/g, `*R$ ${order.total_price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`)
        .replace(/{link_pagamento}/g, `${window.location.origin}?pedido=${order.id}${includeCharge ? '' : '&cobrar=false'}`)
        .replace(/{chave_pix}/g, pixKey)
        .replace(/{copia_cola}/g, pixCopiaCola);
    }

    let templateToUse = includeCharge ? whatsappTemplate : whatsappTemplateNoCharge
    if (!templateToUse) {
      templateToUse = includeCharge
        ? 'Olá {nome}! Seu pedido #{pedido_id} foi entregue. Total: R$ {total}. Agradecemos a preferência!'
        : 'Olá {nome}! Seu pedido #{pedido_id} foi entregue. Agradecemos a preferência!'
    }

    let formattedMsg = templateToUse
      .replace(/{nome}/g, order.customers?.name || 'Cliente')
      .replace(/{pedido_id}/g, order.id.substring(0, 8).toUpperCase())
      .replace(/R\$\s*{total}/g, `*R$ ${order.total_price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`)
      .replace(/{total}/g, `*R$ ${order.total_price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`)
      .replace(/{endereco}/g, order.delivery_address)

    if (templateToUse.includes('{pix}')) {
      formattedMsg = formattedMsg.replace(/{pix}/g, pixMessage)
    }

    // Format items list
    const itemsList = order.order_items.map(item => {
      const qty = item.quantity_final !== null ? item.quantity_final : item.quantity_requested
      const unit = item.products?.unit || 'un'
      const qtyFormatted = unit === 'kg' 
        ? qty.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg'
        : `${qty} ${unit}(s)`
      return `- ${item.products?.name || 'Item'}: ${qtyFormatted} (R$ ${item.price_final?.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || (item.price_unit * qty).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
    }).join('\n')

    formattedMsg = formattedMsg.replace(/{itens}/g, itemsList)

    if (includeCharge && !templateToUse.includes('{pix}') && pixEnabled && pixKey) {
      formattedMsg += `\n\n${pixMessage}`
    }

    if (!includeCharge || !pixEnabled || !pixKey) {
      const trackingLink = `${window.location.origin}?pedido=${order.id}${includeCharge ? '' : '&cobrar=false'}`
      formattedMsg += `\n\n*Acompanhe seu pedido aqui:* ${trackingLink}`
    }

    const phoneClean = order.customers?.phone || ''
    const waUrl = `https://api.whatsapp.com/send?phone=55${phoneClean}&text=${encodeURIComponent(formattedMsg)}`
    
    window.open(waUrl, '_blank')
  }

  const toggleAssembly = async (order) => {
    const nextState = !order.is_assembled
    const title = nextState ? 'Confirmar Montagem' : 'Desmarcar Montagem'
    const message = nextState 
      ? 'Deseja marcar este pedido como montado?' 
      : 'Deseja desmarcar este pedido como montado?'

    showConfirm(title, message, async () => {
      try {
        setAdminLoading(true)
        const { error } = await supabase
          .from('orders')
          .update({ is_assembled: nextState })
          .eq('id', order.id)
        if (error) throw error
        
        // Update local state
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, is_assembled: nextState } : o))
        addToast(nextState ? 'Pedido marcado como montado!' : 'Pedido desmarcado de montado!', 'success')
      } catch (err) {
        console.error('Erro ao atualizar status de montagem:', err.message)
        showAlert('Erro', 'Erro ao atualizar status de montagem.')
      } finally {
        setAdminLoading(false)
      }
    })
  }

  // Admin: Mark as delivered & send WhatsApp
  const handleMarkAsDelivered = async (order) => {
    if (!configured) return
    
    // Check if there are unadjusted items
    const hasUnadjusted = order.order_items.some(item => item.quantity_final === null)
    if (hasUnadjusted) {
      showConfirm(
        'Itens Não Ajustados',
        'Este pedido possui itens fracionados que ainda não foram ajustados. Deseja ajustar antes de finalizar?',
        () => {
          startAdjustingOrder(order)
        },
        () => {
          setDeliveringOrder(order)
        },
        'Ajustar Agora',
        'Finalizar sem Ajustar'
      )
      return
    }

    setDeliveringOrder(order)
  }

  const markAsDeliveredQuery = async (order, includeCharge = true, sendMessage = true) => {
    setAdminLoading(true)
    try {
      // 1. Update order status
      const { error } = await supabase
        .from('orders')
        .update({ status: 'delivered' })
        .eq('id', order.id)

      if (error) throw error

      // Update UI first
      loadAdminOrders()

      // 2. Open WhatsApp link if sendMessage is true, else show success toast
      if (sendMessage) {
        sendWhatsAppMessage(order, includeCharge)
      } else {
        addToast('Pedido baixado como entregue com sucesso!', 'success')
      }
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  const handleRevertToPending = async (order) => {
    showConfirm(
      'Reverter Pedido',
      'Tem certeza que deseja reverter este pedido para a lista de Pendentes (Montados)?',
      async () => {
        setAdminLoading(true)
        try {
          const { error } = await supabase
            .from('orders')
            .update({ status: 'pending', is_assembled: true })
            .eq('id', order.id)

          if (error) throw error
          loadAdminOrders()
          addToast('Pedido revertido para Montados com sucesso!', 'success')
        } catch (err) {
          showAlert('Erro', sanitizeErrorMessage(err))
        } finally {
          setAdminLoading(false)
        }
      }
    )
  }

  const togglePaymentStatus = async (orderId, currentStatus) => {
    if (!configured) return
    const nextStatus = currentStatus === 'paid' ? 'pending' : 'paid'
    const statusText = nextStatus === 'paid' ? 'pago' : 'pendente de pagamento'
    const title = nextStatus === 'paid' ? 'Confirmar Pagamento' : 'Reverter Pagamento'
    const message = nextStatus === 'paid' 
      ? 'Deseja marcar este pedido como Pago?' 
      : 'Deseja reverter o status de pagamento deste pedido?'
      
    showConfirm(title, message, async () => {
      setAdminLoading(true)
      try {
        const { error } = await supabase
          .from('orders')
          .update({ payment_status: nextStatus })
          .eq('id', orderId)

        if (error) throw error

        loadAdminOrders()
        addToast(`Pedido marcado como ${statusText}!`, 'success')
      } catch (err) {
        showAlert('Erro', sanitizeErrorMessage(err))
      } finally {
        setAdminLoading(false)
      }
    })
  }

  // Admin: Resend WhatsApp warning
  const handleSendWhatsAppOnly = (order) => {
    setDeliveringOrder(order)
  }

  // Admin: Seed default products
  const handleSeedDatabase = async () => {
    if (!configured) return
    setAdminLoading(true)
    try {
      const defaultProducts = [
        { name: 'Queijo Coalho Tradicional', description: 'Queijo de fabricação artesanal, perfeito para assar ou grelhar.', price: 42.90, unit: 'kg', is_approximate: true, image_url: 'https://images.unsplash.com/photo-1486299267070-83823f5448dd?w=400&q=80', is_active: true },
        { name: 'Presunto Fatiado Suíno', description: 'Fatias finas de presunto cozido de qualidade superior.', price: 29.90, unit: 'kg', is_approximate: true, image_url: 'https://images.unsplash.com/photo-1524438418049-ab2acb7aa48f?w=400&q=80', is_active: true },
        { name: 'Pão de Forma Tradicional', description: 'Pão super macio ideal para sanduíches do dia a dia.', price: 8.50, unit: 'unidade', is_approximate: false, image_url: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&q=80', is_active: true },
        { name: 'Refrigerante Cola 2L', description: 'Bebida gaseificada refrescante embalagem família.', price: 10.00, unit: 'unidade', is_approximate: false, image_url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&q=80', is_active: true },
        { name: 'Leite Integral UHT 1L', description: 'Caixa de leite integral de alta qualidade.', price: 5.80, unit: 'unidade', is_approximate: false, image_url: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80', is_active: true }
      ]

      const { error } = await supabase
        .from('products')
        .insert(defaultProducts)
      
      if (error) throw error
      showAlert('Sucesso', 'Banco semeado com produtos de demonstração com sucesso!')
      loadProducts()
    } catch (err) {
      showAlert('Erro', sanitizeErrorMessage(err))
    } finally {
      setAdminLoading(false)
    }
  }

  // Logout
  const handleLogout = () => {
    setUser(null)
    // Mantém o carrinho intacto mesmo ao deslogar
    setPhoneInput('')
    setNameInput('')
    setIsNewUser(false)
    setClientPasswordPromptNeeded(false)
    setClientLegacySetupNeeded(false)
    setClientLoginPasswordInput('')
    setClientPasswordInput('')
    setClientPasswordConfirmInput('')
    setClientFoundCustomer(null)
    setIsAdminImpersonating(false)
    setAdminProfile(null)
    localStorage.removeItem('clickentregas_user')
    localStorage.removeItem('clickentregas_impersonating')
    localStorage.removeItem('clickentregas_admin_profile')
    localStorage.removeItem('clickentregas_admin_hash')
    setPage('login')
  }

  const triggerLogout = () => {
    showConfirm(
      'Confirmar Saída',
      'Tem certeza que deseja sair da sua conta?',
      () => {
        handleLogout()
      }
    )
  }

  // Unconfigured View
  if (!configured) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700 p-8 rounded-2xl shadow-xl max-w-md w-full">
          <div className="flex justify-center mb-6">
            <div className="p-3 bg-indigo-500/10 rounded-full text-indigo-400">
              <Settings className="w-12 h-12 animate-spin-slow" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center text-white mb-2">Configuração Necessária</h1>
          <p className="text-slate-400 text-center mb-6 text-sm">
            O aplicativo precisa do link e da chave anônima do Supabase para funcionar.
          </p>
          
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-700 text-xs font-mono text-slate-300 space-y-4 mb-6">
            <p className="text-indigo-400 font-semibold">// Siga estes passos:</p>
            <p>1. Abra o arquivo <code className="text-amber-400">.env</code> na raiz do projeto ClickEntregas.</p>
            <p>2. Substitua o valor de <code className="text-amber-400">VITE_SUPABASE_ANON_KEY</code> pela chave pública do seu painel Supabase (<span className="text-slate-400">Project Settings &gt; API &gt; anon/public</span>).</p>
            <p>3. Reinicie o servidor de desenvolvimento.</p>
          </div>

          <button 
            onClick={() => {
              const isConfigured = isSupabaseConfigured()
              if (isConfigured) {
                setInitialSettingsLoading(true)
              }
              setConfigured(isConfigured)
            }}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-50 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Verificar Novamente
          </button>
        </div>
      </div>
    )
  }

  // Initial settings loading state to prevent flash of default purple colors
  if (initialSettingsLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="relative flex items-center justify-center">
            {/* Outer spinning ring */}
            <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-indigo-600 animate-spin"></div>
            {/* Inner pulsing dot */}
            <div className="absolute w-4 h-4 bg-indigo-600 rounded-full animate-ping"></div>
          </div>
          <span className="text-xs font-semibold text-slate-500 font-mono tracking-wider uppercase">Carregando Aplicativo...</span>
        </div>
      </div>
    )
  }

  const renderPageContent = () => {
    // 0. TRACKING PAGE
    if (page === 'tracking') {
      if (trackingLoading) {
        return (
          <div className={`min-h-screen ${theme.pageBg} flex items-center justify-center p-4`}>
            <div className={`${theme.cardBg} p-8 rounded-2xl max-w-md w-full text-center space-y-4`}>
              <RefreshCw className={`w-10 h-10 animate-spin mx-auto ${theme.text}`} />
              <p className="text-sm text-slate-500 font-semibold">Carregando informações do pedido...</p>
            </div>
          </div>
        )
      }

      if (trackingError || !trackingOrder) {
        return (
          <div className={`min-h-screen ${theme.pageBg} flex items-center justify-center p-4`}>
            <div className={`${theme.cardBg} p-8 rounded-2xl max-w-md w-full text-center space-y-4`}>
              <div className="p-3 bg-red-50 text-red-500 rounded-full w-fit mx-auto">
                <Info className="w-8 h-8" />
              </div>
              <h3 className="font-bold text-slate-800 text-lg">Erro ao Localizar</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                {trackingError || 'Não foi possível encontrar as informações deste pedido.'}
              </p>
              <button
                onClick={() => {
                  if (user) {
                    setPage('catalog')
                  } else {
                    setPage('login')
                  }
                }}
                className={`w-full py-2.5 text-white text-xs font-semibold rounded-xl transition ${theme.bg} ${theme.hoverBg}`}
              >
                Ir para a Loja
              </button>
            </div>
          </div>
        )
      }

      const order = trackingOrder
      const dateFormatted = new Date(order.created_at).toLocaleString('pt-BR', { 
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' 
      })
      
      const isCancelled = order.status === 'cancelled'
      const isDelivered = order.status === 'delivered'
      const isAssembled = order.is_assembled
      
      // Determine active steps
      const step1Active = true // Recebido is always active
      const step2Active = isAssembled || isDelivered
      const step3Active = isDelivered

      return (
        <div className={`min-h-screen ${theme.pageBg} flex flex-col`}>
          {/* Header */}
          <header className={`${theme.headerBg} sticky top-0 z-40`}>
            <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
              <button 
                onClick={() => {
                  if (user) {
                    setPage('catalog')
                  } else {
                    setPage('login')
                  }
                }}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition font-medium text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                {user ? 'Voltar ao Catálogo' : 'Acessar Loja'}
              </button>
              <span className="font-bold text-slate-800 text-base">Acompanhar Pedido</span>
              <div className="w-20"></div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-6">
            
            {/* Brand custom banner */}
            <div 
              className={`rounded-2xl p-6 text-white relative overflow-hidden shadow-sm min-h-32 flex flex-col justify-center transition-all duration-300 ${
                clientBrandBanner ? '' : theme.gradientBg
              }`}
              style={clientBrandBanner ? { backgroundImage: `linear-gradient(to right, rgba(15, 23, 42, 0.85), rgba(15, 23, 42, 0.45)), url(${clientBrandBanner})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
            >
              <div className="relative z-10 flex items-center gap-4">
                {clientBrandLogo ? (
                  <div className="w-14 h-14 rounded-xl bg-white border border-slate-100 p-1 flex items-center justify-center shadow-md shrink-0">
                    <img src={clientBrandLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
                  </div>
                ) : (
                  <div className={`p-2.5 bg-white/20 backdrop-blur-md text-white rounded-xl shadow-sm shrink-0`}>
                    <ShoppingBag className="w-7 h-7" />
                  </div>
                )}
                <div>
                  <h2 className="text-xl font-bold text-white mb-0.5">{clientBrandName}</h2>
                  <p className="text-white/80 text-xs">{clientBrandSlogan}</p>
                </div>
              </div>
            </div>

            {/* Pix Payment Section */}
            {pixEnabled && pixKey && !isCancelled && order.payment_status !== 'paid' && new URLSearchParams(window.location.search).get('cobrar') !== 'false' && (
              <div className={`${theme.cardBg} p-6 rounded-2xl shadow-sm space-y-4`}>
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2 border-b border-slate-50 pb-2">
                  <DollarSign className={`w-4 h-4 ${theme.text}`} />
                  Pagamento via Pix
                </h4>
                
                <p className="text-xs text-slate-800 text-center leading-relaxed font-bold">
                  Para pagar seu pedido, escaneie o QR Code abaixo ou copie e cole o código Pix Copia e Cola.
                </p>
                
                <div className={`${theme.inputBg} border ${theme.lightBorder} p-4 rounded-xl flex flex-col items-center gap-4`}>
                  {pixType === 'dynamic' ? (
                    <>
                      <img 
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(generatePixCopiaCola({ chave: pixKey, beneficiario: pixName, cidade: pixCity, valor: order.total_price }))}`}
                        alt="QR Code Pix"
                        className="w-40 h-40 bg-white p-2 rounded-lg border border-slate-200 shadow-sm"
                      />
                    </>
                  ) : (
                    pixQrCodeStatic && (
                      <>
                        <img 
                          src={pixQrCodeStatic}
                          alt="QR Code Pix"
                          className="w-40 h-40 bg-white p-2 rounded-lg border border-slate-200 shadow-sm"
                        />
                      </>
                    )
                  )}

                  <div className="w-full space-y-1.5">
                    <span className="block text-xxs font-semibold text-slate-400 uppercase tracking-wider font-mono">
                      {pixType === 'dynamic' ? 'Pix Copia e Cola' : 'Chave Pix'}
                    </span>
                    <div className="flex gap-2 w-full">
                      <input
                        type="text"
                        readOnly
                        value={pixType === 'dynamic' ? generatePixCopiaCola({ chave: pixKey, beneficiario: pixName, cidade: pixCity, valor: order.total_price }) : pixKey}
                        className="flex-1 bg-white/95 border border-slate-200 px-3 py-2 rounded-xl text-xs font-mono select-all focus:outline-none shadow-inner"
                      />
                      <button
                        onClick={() => {
                          const code = pixType === 'dynamic' ? generatePixCopiaCola({ chave: pixKey, beneficiario: pixName, cidade: pixCity, valor: order.total_price }) : pixKey;
                          navigator.clipboard.writeText(code);
                          addToast('Pix copiado com sucesso!', 'success');
                        }}
                        className={`px-4 py-2 text-white font-semibold rounded-xl text-xs transition shadow-sm ${theme.bg} ${theme.hoverBg}`}
                      >
                        Copiar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Payment Received Message */}
            {order.payment_status === 'paid' && (
              <div className={`${theme.cardBg} p-6 rounded-2xl shadow-sm text-center space-y-3 border border-emerald-200 bg-emerald-50/10`}>
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <Check className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-slate-800 text-sm">Pagamento Confirmado!</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  O estabelecimento já confirmou o recebimento do seu Pix de <strong>R$ {order.total_price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>. Muito obrigado pela preferência!
                </p>
              </div>
            )}

            {/* Evaluation call-to-action */}
            {isDelivered && order.rating === null && (
              <div className={`${theme.cardBg} p-6 rounded-2xl shadow-sm text-center space-y-3 border-amber-200 bg-amber-50/10`}>
                <Star className="w-8 h-8 text-amber-500 fill-amber-400 mx-auto animate-bounce" />
                <h4 className="font-bold text-slate-800 text-sm">Seu pedido foi entregue!</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  Compartilhe sua opinião conosco para nos ajudar a melhorar nosso atendimento. Leva menos de um minuto!
                </p>
                <button
                  onClick={() => {
                    setOrderToEvaluate(order)
                    setEvaluationRating(0)
                    setEvaluationComment('')
                  }}
                  className={`py-2 px-4 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl transition shadow-sm`}
                >
                  Avaliar Pedido
                </button>
              </div>
            )}

            {/* Tracking Status Card */}
            <div className={`${theme.cardBg} p-6 rounded-2xl shadow-sm space-y-6`}>
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <span className="text-xxs font-bold text-slate-400 uppercase tracking-wider font-mono">Pedido</span>
                  <h3 className="font-mono text-sm font-bold text-slate-800">#{order.id.substring(0, 8).toUpperCase()}</h3>
                </div>
                <div className="text-right">
                  <span className="text-xxs font-bold text-slate-400 uppercase tracking-wider font-mono block">Realizado em</span>
                  <span className="text-xs text-slate-600 font-semibold">{dateFormatted}</span>
                </div>
              </div>

              {/* Timeline */}
              {isCancelled ? (
                <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-100 flex items-center gap-3">
                  <X className="w-6 h-6 shrink-0 text-red-500" />
                  <div>
                    <h4 className="font-bold text-sm">Pedido Cancelado</h4>
                    <p className="text-xs text-red-600/80">Infelizmente, este pedido foi cancelado pelo estabelecimento. Em caso de dúvidas, entre em contato via WhatsApp.</p>
                  </div>
                </div>
              ) : (
                <div className="relative py-2">
                  {/* Horizontal line connector */}
                  <div className={`absolute top-5 left-8 right-8 h-1 ${theme.lightBorder} -z-10`} />
                  {/* Colored progress line */}
                  <div 
                    className={`absolute top-5 left-8 h-1 ${theme.bg} -z-10 transition-all duration-500`} 
                    style={{ 
                      width: step3Active ? 'calc(100% - 4rem)' : step2Active ? 'calc(50% - 2rem)' : '0%' 
                    }}
                  />

                  <div className="grid grid-cols-3 text-center">
                    {/* Step 1: Recebido */}
                    <div className="flex flex-col items-center gap-2">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                        step1Active 
                          ? `${theme.bg} ${theme.border} text-white shadow-md` 
                          : 'bg-white border-slate-200 text-slate-400'
                      }`}>
                        <Check className="w-5 h-5" />
                      </div>
                      <span className="text-xs font-bold text-slate-700">Recebido</span>
                      <span className="text-xxs text-slate-400 max-w-[80px] hidden sm:inline">Pedido no sistema</span>
                    </div>

                    {/* Step 2: Montado */}
                    <div className="flex flex-col items-center gap-2">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                        step2Active 
                          ? `${theme.bg} ${theme.border} text-white shadow-md` 
                          : 'bg-white border-slate-200 text-slate-400'
                      }`}>
                        {step2Active ? <Check className="w-5 h-5" /> : <Scale className="w-5 h-5" />}
                      </div>
                      <span className="text-xs font-bold text-slate-700">Montado</span>
                      <span className="text-xxs text-slate-400 max-w-[80px] hidden sm:inline">Ajustado e embalado</span>
                    </div>

                    {/* Step 3: Entregue */}
                    <div className="flex flex-col items-center gap-2">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                        step3Active 
                          ? `${theme.bg} ${theme.border} text-white shadow-md` 
                          : 'bg-white/80 border-slate-200 text-slate-400'
                      }`}>
                        {step3Active ? <Check className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
                      </div>
                      <span className="text-xs font-bold text-slate-700">Entregue</span>
                      <span className="text-xxs text-slate-400 max-w-[80px] hidden sm:inline">Saiu para entrega</span>
                    </div>
                  </div>
                </div>
              )}
            </div>



            {/* Items & Address Summary */}
            <div className={`${theme.cardBg} p-6 rounded-2xl shadow-sm space-y-4`}>
              <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2 border-b border-slate-50 pb-2">
                <Package className={`w-4 h-4 ${theme.text}`} />
                Resumo do Pedido
              </h4>

              {/* Products List */}
              <div className={`${theme.inputBg} p-4 rounded-xl divide-y ${theme.lightBorder}/40 space-y-2 border ${theme.lightBorder}/30`}>
                {order.order_items.map((item) => {
                  const qty = item.quantity_final !== null ? item.quantity_final : item.quantity_requested
                  const unit = item.products?.unit || 'un'
                  return (
                    <div key={item.id} className="pt-2 first:pt-0 flex items-center justify-between text-xs text-slate-600">
                      <div className="flex items-center gap-2">
                        {item.products?.image_url && (
                          <img src={item.products.image_url} alt="" className="w-8 h-8 object-cover rounded-lg border border-slate-100" />
                        )}
                        <span>{formatQuantity(qty, unit)} x {item.products?.name || 'Item do pedido'}</span>
                      </div>
                      <span className="font-semibold text-slate-800">
                        R$ {item.price_final !== null ? item.price_final.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (item.price_unit * qty).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )
                })}

                {order.discount > 0 && (
                  <div className="pt-2 flex items-center justify-between text-emerald-600 text-xs font-semibold">
                    <span>Desconto {order.coupon_code ? `(${order.coupon_code})` : ''}:</span>
                    <span>- R$ {order.discount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="pt-3 flex items-center justify-between text-slate-800 border-t border-slate-200/50">
                  <span className="font-bold text-xs">Total final</span>
                  <span className="font-bold text-base text-slate-900">
                    R$ {order.total_price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Delivery address details */}
              <div className={`${theme.inputBg} p-3 rounded-lg border ${theme.lightBorder}/30 text-xxs text-slate-500 space-y-1`}>
                <p className="flex items-start gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  <span><strong>Endereço de Entrega:</strong> {order.delivery_address}</span>
                </p>
                {order.notes && (
                  <p className="flex items-start gap-1">
                    <Info className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                    <span><strong>Observações:</strong> {order.notes}</span>
                  </p>
                )}
              </div>
            </div>



          </main>
        </div>
      )
    }

    // 1. LOGIN PAGE
    if (page === 'login') {
      return (
      <div className={`min-h-screen ${theme.pageBg} flex items-center justify-center p-4`}>
        <div className={`${theme.cardBg} p-8 rounded-2xl max-w-md w-full animate-scale-in`}>
          <div className="flex justify-center mb-6">
            {clientBrandLogo ? (
              <div className={`w-16 h-16 rounded-2xl bg-white/80 border ${theme.lightBorder} p-2 flex items-center justify-center shadow-md`}>
                <img src={clientBrandLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className={`p-3.5 ${theme.bg} text-white rounded-2xl shadow-md ${theme.shadowColor}`}>
                <ShoppingBag className="w-8 h-8" />
              </div>
            )}
          </div>
          
          <h2 className="text-2xl font-bold text-center text-slate-800 mb-1">{clientBrandName}</h2>
          
          {adminPasswordSetupNeeded ? (
            <>
              <p className="text-slate-500 text-center mb-6 text-sm">
                <strong>Configurar Acesso Administrativo</strong><br />
                Defina uma senha segura para o seu próximo login.
              </p>

              {authError && (
                <div className="bg-red-50 text-red-600 p-3 rounded-xl text-xs mb-4 border border-red-100 flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              <form onSubmit={handleSaveAdminPassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Senha do Administrador</label>
                  <div className="relative">
                    <input
                      type={showAdminPassword ? "text" : "password"}
                      placeholder="Minimo 6 caracteres"
                      value={adminPasswordInput}
                      onChange={(e) => setAdminPasswordInput(e.target.value)}
                      className={`w-full pl-4 pr-11 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowAdminPassword(!showAdminPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
                      title={showAdminPassword ? "Ocultar senha" : "Ver senha"}
                    >
                      {showAdminPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Confirmar Senha</label>
                  <div className="relative">
                    <input
                      type={showAdminConfirmPassword ? "text" : "password"}
                      placeholder="Repita a senha"
                      value={adminPasswordConfirmInput}
                      onChange={(e) => setAdminPasswordConfirmInput(e.target.value)}
                      className={`w-full pl-4 pr-11 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowAdminConfirmPassword(!showAdminConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
                      title={showAdminConfirmPassword ? "Ocultar senha" : "Ver senha"}
                    >
                      {showAdminConfirmPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full py-3.5 text-white font-semibold rounded-xl transition shadow-md flex items-center justify-center gap-2 text-sm disabled:opacity-55 ${theme.shadowColor} ${theme.bg} ${theme.hoverBg}`}
                >
                  {loading ? 'Salvando...' : 'Salvar Senha e Entrar'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAdminPasswordSetupNeeded(false)
                    setAuthError('')
                  }}
                  className={`w-full text-center text-xs ${theme.text} font-medium hover:underline py-1`}
                >
                  Voltar
                </button>
              </form>
            </>
          ) : adminPasswordPromptNeeded ? (
            <>
              <p className="text-slate-500 text-center mb-6 text-sm">
                <strong>Painel de Controle Admin</strong><br />
                Insira sua senha de administrador para continuar.
              </p>

              {authError && (
                <div className="bg-red-50 text-red-600 p-3 rounded-xl text-xs mb-4 border border-red-100 flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              <form onSubmit={handleVerifyAdminPassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Senha</label>
                  <div className="relative">
                    <input
                      type={showAdminPassword ? "text" : "password"}
                      placeholder="Sua senha de admin"
                      value={adminPasswordInput}
                      onChange={(e) => setAdminPasswordInput(e.target.value)}
                      className={`w-full pl-4 pr-11 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowAdminPassword(!showAdminPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
                      title={showAdminPassword ? "Ocultar senha" : "Ver senha"}
                    >
                      {showAdminPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full py-3.5 text-white font-semibold rounded-xl transition shadow-md flex items-center justify-center gap-2 text-sm disabled:opacity-55 ${theme.shadowColor} ${theme.bg} ${theme.hoverBg}`}
                >
                  {loading ? 'Acessando...' : 'Acessar Painel'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAdminPasswordPromptNeeded(false)
                    setAuthError('')
                  }}
                  className={`w-full text-center text-xs ${theme.text} font-medium hover:underline py-1`}
                >
                  Voltar
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="text-slate-500 text-center mb-6 text-sm">
                {!isNewUser ? 'Acesse o catálogo e faça seus pedidos rapidamente' : 'Preencha seus dados para completar o cadastro'}
              </p>

              {authError && (
                <div className="bg-red-50 text-red-600 p-3 rounded-xl text-xs mb-4 border border-red-100 flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              {isNewUser ? (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Telefone Selecionado</label>
                    <div className={`px-4 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-600 font-medium flex items-center gap-3`}>
                      <Phone className="w-5 h-5 text-slate-400" />
                      <span>{getFormattedPhone(phoneInput)}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Como devemos te chamar? (Nome)</label>
                    <div className="relative">
                      <User className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Seu nome completo"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        className={`w-full pl-11 pr-4 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium`}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Criar Senha de Acesso</label>
                    <div className="relative">
                      <input
                        type={showClientPassword ? "text" : "password"}
                        placeholder="Mínimo 4 caracteres"
                        value={clientPasswordInput}
                        onChange={(e) => setClientPasswordInput(e.target.value)}
                        className={`w-full pl-4 pr-11 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium`}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowClientPassword(!showClientPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
                        title={showClientPassword ? "Ocultar senha" : "Ver senha"}
                      >
                        {showClientPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Confirmar Nova Senha</label>
                    <div className="relative">
                      <input
                        type={showClientPasswordConfirm ? "text" : "password"}
                        placeholder="Repita sua senha"
                        value={clientPasswordConfirmInput}
                        onChange={(e) => setClientPasswordConfirmInput(e.target.value)}
                        className={`w-full pl-4 pr-11 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium`}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowClientPasswordConfirm(!showClientPasswordConfirm)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
                        title={showClientPasswordConfirm ? "Ocultar senha" : "Ver senha"}
                      >
                        {showClientPasswordConfirm ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Pergunta de Segurança para Recuperação */}
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-3">
                    <div>
                      <label className="block text-xxs font-bold text-slate-600 uppercase tracking-wider mb-1 font-mono">Pergunta de Segurança (Para recuperar a senha)</label>
                      <select
                        value={securityQuestionInput}
                        onChange={(e) => setSecurityQuestionInput(e.target.value)}
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                      >
                        {SECURITY_QUESTIONS.map((q, idx) => (
                          <option key={idx} value={q}>{q}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xxs font-bold text-slate-600 uppercase tracking-wider mb-1 font-mono">Sua Resposta Secreta</label>
                      <input
                        type="text"
                        placeholder="Ex: Maria, Azul, Gol..."
                        value={securityAnswerInput}
                        onChange={(e) => setSecurityAnswerInput(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-3.5 text-white font-semibold rounded-xl transition shadow-md flex items-center justify-center gap-2 text-sm disabled:opacity-55 ${theme.shadowColor} ${theme.bg} ${theme.hoverBg}`}
                  >
                    {loading ? 'Cadastrando...' : 'Concluir Cadastro e Entrar'}
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => {
                      setIsNewUser(false)
                      setAuthError('')
                    }}
                    className={`w-full text-center text-xs ${theme.text} font-medium hover:underline py-1`}
                  >
                    Voltar
                  </button>
                </form>
              ) : clientPasswordPromptNeeded ? (
                <form onSubmit={handleClientPasswordLogin} className="space-y-4">
                  <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 flex items-center justify-between">
                    <div>
                      <span className="text-xxs uppercase font-bold text-amber-800 font-mono block">Cliente Cadastrado</span>
                      <span className="text-sm font-bold text-slate-800 block">{clientFoundCustomer?.name}</span>
                      <span className="text-xs text-slate-500 font-mono">{getFormattedPhone(clientFoundCustomer?.phone)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setClientPasswordPromptNeeded(false)
                        setAuthError('')
                      }}
                      className="text-xs text-amber-800 hover:underline font-semibold"
                    >
                      Trocar
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Senha de Acesso</label>
                    <div className="relative">
                      <input
                        type={showClientLoginPassword ? "text" : "password"}
                        placeholder="Digite sua senha"
                        value={clientLoginPasswordInput}
                        onChange={(e) => setClientLoginPasswordInput(e.target.value)}
                        className={`w-full pl-4 pr-11 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium`}
                        required
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowClientLoginPassword(!showClientLoginPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
                        title={showClientLoginPassword ? "Ocultar senha" : "Ver senha"}
                      >
                        {showClientLoginPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleStartForgotPassword}
                      className={`text-xs font-semibold ${theme.text} hover:underline`}
                    >
                      Esqueci minha senha
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-3.5 text-white font-semibold rounded-xl transition shadow-md flex items-center justify-center gap-2 text-sm disabled:opacity-55 ${theme.shadowColor} ${theme.bg} ${theme.hoverBg}`}
                  >
                    {loading ? 'Entrando...' : 'Entrar no Catálogo'}
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setClientPasswordPromptNeeded(false)
                      setAuthError('')
                    }}
                    className={`w-full text-center text-xs ${theme.text} font-medium hover:underline py-1`}
                  >
                    Voltar
                  </button>
                </form>
              ) : clientLegacySetupNeeded ? (
                <form onSubmit={handleSaveLegacyCustomerPassword} className="space-y-4">
                  <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 flex items-center justify-between">
                    <div>
                      <span className="text-xxs uppercase font-bold text-amber-800 font-mono block">Cliente Cadastrado</span>
                      <span className="text-sm font-bold text-slate-800 block">{clientFoundCustomer?.name}</span>
                      <span className="text-xs text-slate-500 font-mono">{getFormattedPhone(clientFoundCustomer?.phone)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setClientLegacySetupNeeded(false)
                        setAuthError('')
                      }}
                      className="text-xs text-amber-800 hover:underline font-semibold"
                    >
                      Trocar
                    </button>
                  </div>

                  <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-3 text-xs text-indigo-900 flex items-start gap-2">
                    <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <span>Crie sua senha de acesso e pergunta secreta para proteger sua conta e acessar seus pedidos.</span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Criar Senha de Acesso</label>
                    <div className="relative">
                      <input
                        type={showClientPassword ? "text" : "password"}
                        placeholder="Mínimo 4 caracteres"
                        value={clientPasswordInput}
                        onChange={(e) => setClientPasswordInput(e.target.value)}
                        className={`w-full pl-4 pr-11 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium`}
                        required
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowClientPassword(!showClientPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
                        title={showClientPassword ? "Ocultar senha" : "Ver senha"}
                      >
                        {showClientPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Confirmar Nova Senha</label>
                    <div className="relative">
                      <input
                        type={showClientPasswordConfirm ? "text" : "password"}
                        placeholder="Repita a nova senha"
                        value={clientPasswordConfirmInput}
                        onChange={(e) => setClientPasswordConfirmInput(e.target.value)}
                        className={`w-full pl-4 pr-11 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium`}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowClientPasswordConfirm(!showClientPasswordConfirm)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition"
                        title={showClientPasswordConfirm ? "Ocultar senha" : "Ver senha"}
                      >
                        {showClientPasswordConfirm ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Pergunta de Segurança para Recuperação */}
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-3">
                    <div>
                      <label className="block text-xxs font-bold text-slate-600 uppercase tracking-wider mb-1 font-mono">Pergunta de Segurança (Para recuperar a senha)</label>
                      <select
                        value={securityQuestionInput}
                        onChange={(e) => setSecurityQuestionInput(e.target.value)}
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                      >
                        {SECURITY_QUESTIONS.map((q, idx) => (
                          <option key={idx} value={q}>{q}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xxs font-bold text-slate-600 uppercase tracking-wider mb-1 font-mono">Sua Resposta Secreta</label>
                      <input
                        type="text"
                        placeholder="Ex: Maria, Azul, Gol..."
                        value={securityAnswerInput}
                        onChange={(e) => setSecurityAnswerInput(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-3.5 text-white font-semibold rounded-xl transition shadow-md flex items-center justify-center gap-2 text-sm disabled:opacity-55 ${theme.shadowColor} ${theme.bg} ${theme.hoverBg}`}
                  >
                    {loading ? 'Salvando...' : 'Salvar Senha e Entrar'}
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setClientLegacySetupNeeded(false)
                      setAuthError('')
                    }}
                    className={`w-full text-center text-xs ${theme.text} font-medium hover:underline py-1`}
                  >
                    Voltar
                  </button>
                </form>
              ) : clientSecuritySetupNeeded ? (
                <form onSubmit={handleSaveClientSecurityQuestion} className="space-y-4">
                  <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 flex items-center justify-between">
                    <div>
                      <span className="text-xxs uppercase font-bold text-amber-800 font-mono block">Segurança da Conta</span>
                      <span className="text-sm font-bold text-slate-800 block">{user?.name || clientFoundCustomer?.name}</span>
                      <span className="text-xs text-slate-500 font-mono">{getFormattedPhone(user?.phone || clientFoundCustomer?.phone || phoneInput)}</span>
                    </div>
                  </div>

                  <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-3 text-xs text-indigo-900 flex items-start gap-2">
                    <Key className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <span>Cadastre sua pergunta e resposta secreta para recuperar seu acesso caso esqueça sua senha.</span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-3">
                    <div>
                      <label className="block text-xxs font-bold text-slate-600 uppercase tracking-wider mb-1 font-mono">Escolha sua Pergunta de Segurança</label>
                      <select
                        value={securityQuestionInput}
                        onChange={(e) => setSecurityQuestionInput(e.target.value)}
                        className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                      >
                        {SECURITY_QUESTIONS.map((q, idx) => (
                          <option key={idx} value={q}>{q}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xxs font-bold text-slate-600 uppercase tracking-wider mb-1 font-mono">Sua Resposta Secreta</label>
                      <input
                        type="text"
                        placeholder="Ex: Maria, Azul, Gol..."
                        value={securityAnswerInput}
                        onChange={(e) => setSecurityAnswerInput(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-3.5 text-white font-semibold rounded-xl transition shadow-md flex items-center justify-center gap-2 text-sm disabled:opacity-55 ${theme.shadowColor} ${theme.bg} ${theme.hoverBg}`}
                  >
                    {loading ? 'Salvando...' : 'Salvar Pergunta e Entrar'}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Telefone / WhatsApp</label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
                      <input
                        type="tel"
                        placeholder="(83) 99999-9999"
                        value={getFormattedPhone(phoneInput)}
                        onChange={handlePhoneChange}
                        className={`w-full pl-11 pr-4 py-3 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium`}
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-3.5 text-white font-semibold rounded-xl transition shadow-md flex items-center justify-center gap-2 text-sm disabled:opacity-55 ${theme.shadowColor} ${theme.bg} ${theme.hoverBg}`}
                  >
                    {loading ? 'Entrando...' : 'Continuar'}
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={handleStartForgotPassword}
                      className={`text-xs font-semibold ${theme.text} hover:underline`}
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>

        {/* MODAL: FORGOT PASSWORD (SECURITY QUESTION RECOVERY) */}
        {showForgotPasswordModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4 animate-scale-in text-center">
              <div className="mx-auto w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center shadow-inner">
                <Key className="w-6 h-6" />
              </div>

              <div className="space-y-1">
                <h3 className="font-bold text-slate-800 text-base">Recuperação de Senha</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {forgotPasswordStep === 'answer' ? (
                    <>Responda à sua pergunta secreta para redefinir a senha da conta <span className="font-bold text-slate-700">{getFormattedPhone(clientFoundCustomer?.phone || phoneInput)}</span>:</>
                  ) : (
                    <>Resposta confirmada com sucesso! Crie sua nova senha de acesso:</>
                  )}
                </p>
              </div>

              {forgotPasswordStep === 'answer' ? (
                <form onSubmit={handleVerifySecurityAnswer} className="space-y-3.5 text-left pt-1">
                  <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-3.5">
                    <span className="text-xxs font-bold text-amber-800 uppercase tracking-wider block font-mono">Pergunta Secreta:</span>
                    <span className="text-xs font-bold text-slate-800 block mt-1">
                      {clientFoundCustomer?.security_question || "Qual é o seu nome completo cadastrado na conta?"}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xxs font-bold text-slate-500 uppercase tracking-wider mb-1 font-mono">Sua Resposta</label>
                    <input
                      type="text"
                      placeholder={clientFoundCustomer?.security_question ? "Digite sua resposta secreta" : "Digite seu nome completo"}
                      value={forgotPasswordAnswerInput}
                      onChange={(e) => setForgotPasswordAnswerInput(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-xs font-medium"
                      required
                      autoFocus
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition shadow-sm mt-2"
                  >
                    Validar Resposta
                  </button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => setShowForgotPasswordModal(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs font-semibold"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleConfirmResetPassword} className="space-y-3.5 text-left pt-1">
                  <div>
                    <label className="block text-xxs font-bold text-slate-500 uppercase tracking-wider mb-1 font-mono">Nova Senha</label>
                    <div className="relative">
                      <input
                        type={showForgotNewPassword ? "text" : "password"}
                        placeholder="Mínimo 4 caracteres"
                        value={forgotPasswordNewPassword}
                        onChange={(e) => setForgotPasswordNewPassword(e.target.value)}
                        className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-xs font-medium"
                        required
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowForgotNewPassword(!showForgotNewPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                        title={showForgotNewPassword ? "Ocultar" : "Ver"}
                      >
                        {showForgotNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xxs font-bold text-slate-500 uppercase tracking-wider mb-1 font-mono">Confirmar Nova Senha</label>
                    <div className="relative">
                      <input
                        type={showForgotConfirmPassword ? "text" : "password"}
                        placeholder="Repita a nova senha"
                        value={forgotPasswordConfirmPassword}
                        onChange={(e) => setForgotPasswordConfirmPassword(e.target.value)}
                        className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-xs font-medium"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowForgotConfirmPassword(!showForgotConfirmPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                        title={showForgotConfirmPassword ? "Ocultar" : "Ver"}
                      >
                        {showForgotConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition shadow-sm disabled:opacity-50 mt-2"
                  >
                    {loading ? 'Salvando...' : 'Salvar Nova Senha e Entrar'}
                  </button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={() => setShowForgotPasswordModal(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs font-semibold"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // 2. CATALOG & ORDERS PAGE (CLIENT / IMPERSONATED CLIENT)
  if (page === 'catalog') {
    const filteredProducts = products.filter(p => 
      p.is_active && (
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    )

    return (
      <div className="min-h-screen bg-[#faf6ee] flex flex-col font-sans">
        {/* Impersonation Warning Banner */}
        {isAdminImpersonating && (
          <div className="bg-amber-500 text-white py-2.5 px-4 font-semibold text-xs sm:text-sm shadow-md flex items-center justify-between sticky top-0 z-50">
            <div className="flex items-center gap-2 max-w-xl truncate">
              <User className="w-4 h-4 text-amber-100 shrink-0" />
              <span>Fazendo pedido em nome de: <strong className="text-white underline">{user.name}</strong> ({getFormattedPhone(user.phone)})</span>
            </div>
            <button
              onClick={handleStopImpersonating}
              className="px-3 py-1.5 bg-white hover:bg-slate-50 text-amber-800 rounded-lg text-xs font-bold transition shrink-0 shadow-sm"
            >
              Voltar ao Painel Admin
            </button>
          </div>
        )}

        {/* Modern Header */}
        <header className="sticky top-0 z-40 bg-[#faf6ee]/95 backdrop-blur-md border-b border-amber-200/80 shadow-2xs transition-all">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            
            {/* Store Brand Logo & Name (Clicks back to Catalog / Menu) */}
            <button 
              onClick={() => setClientTab('catalog')}
              className="flex items-center gap-2.5 min-w-0 text-left hover:opacity-90 transition cursor-pointer group"
              title="Voltar ao início do cardápio"
            >
              {clientBrandLogo ? (
                <div className="w-10 h-10 rounded-xl bg-white border border-amber-200/90 p-1 flex items-center justify-center shadow-2xs shrink-0 overflow-hidden group-hover:border-amber-300 transition-colors">
                  <img src={clientBrandLogo} alt={clientBrandName || "Logo"} className="max-w-full max-h-full object-contain" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-800 shrink-0 shadow-2xs group-hover:bg-amber-200 transition-colors">
                  <ShoppingBag className="w-4.5 h-4.5 text-amber-800" />
                </div>
              )}
              <div className="min-w-0">
                <span className="font-black text-slate-900 text-sm sm:text-base tracking-tight truncate block leading-tight">
                  {clientBrandName || "ClickEntregas"}
                </span>
                <p className="text-xxs text-slate-500 font-medium truncate">
                  {isAdminImpersonating ? `Em nome de: ${user.name}` : (user.name ? `Olá, ${user.name.split(' ')[0]}` : 'Cardápio Digital')}
                </p>
              </div>
            </button>

            {/* Actions: Orders (ReceiptText), Cart (ShoppingCart), Profile, Admin Switch */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Client Orders / Activity Receipt */}
              <button 
                onClick={() => {
                  const nextTab = clientTab === 'orders' ? 'catalog' : 'orders'
                  setClientTab(nextTab)
                  if (nextTab === 'orders') {
                    setClientOrderHistoryTab('in_progress')
                    loadClientOrders()
                  }
                }}
                className={`relative w-10 h-10 rounded-full border border-amber-200 flex items-center justify-center transition ${clientTab === 'orders' ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white hover:bg-amber-50 text-slate-700'}`}
                title="Histórico de Pedidos"
              >
                <ReceiptText className="w-4.5 h-4.5" />
                {clientOrders.some(o => o.status !== 'delivered' && o.status !== 'cancelled') && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-orange-500 rounded-full ring-2 ring-white" />
                )}
              </button>

              {/* Shopping Cart */}
              <button 
                onClick={() => setShowCartModal(true)}
                className="relative w-10 h-10 rounded-full bg-white hover:bg-amber-50 border border-amber-200 flex items-center justify-center text-slate-700 transition"
                title="Ver Carrinho"
              >
                <ShoppingCart className="w-4.5 h-4.5" />
                {cart.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-amber-600 text-white text-xxs font-extrabold w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-white font-mono shadow-xs">
                    {cart.reduce((t, i) => t + (i.product.unit === 'kg' ? 1 : i.quantity), 0)}
                  </span>
                )}
              </button>

              {/* Profile / Edit */}
              <button 
                onClick={openEditProfileModal}
                className="w-10 h-10 rounded-full bg-white hover:bg-amber-50 border border-amber-200 flex items-center justify-center text-slate-700 transition"
                title="Meu Perfil"
              >
                <User className="w-4.5 h-4.5" />
              </button>

              {/* Admin Button / Logout */}
              {(user.isAdmin || user.phone === adminPhone) ? (
                <button 
                  onClick={() => {
                    if (isAdminImpersonating) {
                      handleStopImpersonating()
                    } else {
                      setPage('admin')
                    }
                  }}
                  className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-full text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
                  title="Painel Admin"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Admin</span>
                </button>
              ) : (
                <button 
                  onClick={triggerLogout}
                  className="w-10 h-10 rounded-full hover:bg-red-50 hover:text-red-600 border border-amber-200 flex items-center justify-center text-slate-400 transition"
                  title="Sair"
                >
                  <LogOut className="w-4.5 h-4.5" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-5 pb-24 space-y-6">
          
          {/* VIEW: CATALOG */}
          {clientTab === 'catalog' && (
            <>
              {/* Banner Hero Panel */}
              <div 
                className={`rounded-2xl p-6 sm:p-7 text-white relative overflow-hidden shadow-sm min-h-36 flex flex-col justify-center transition-all duration-300 ${
                  clientBrandBanner ? '' : theme.gradientBg
                }`}
                style={clientBrandBanner ? { 
                  backgroundImage: `linear-gradient(to right, rgba(15, 23, 42, 0.85), rgba(15, 23, 42, 0.35)), url(${clientBrandBanner})`, 
                  backgroundSize: 'cover', 
                  backgroundPosition: 'center' 
                } : {}}
              >
                <div className="relative z-10 max-w-md">
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2 leading-tight drop-shadow-xs">
                    {clientBrandSlogan || "Produtos de qualidade para sua família!"}
                  </h2>
                  <p className="text-white/90 text-xs sm:text-sm font-medium leading-relaxed drop-shadow-xs">
                    Adicione produtos selecionados ao carrinho e feche o pedido de forma fácil.
                  </p>
                </div>
                {!clientBrandBanner && (
                  <div className="absolute right-0 bottom-0 opacity-15 hidden md:block">
                    <Truck className="w-64 h-64 -mb-10 -mr-10" />
                  </div>
                )}
              </div>

              {/* Search Bar (Clean Full Width) */}
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar ovos, queijos, doces..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-10 py-3.5 bg-white border border-amber-200 rounded-2xl text-slate-800 text-sm shadow-2xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 placeholder:text-slate-400 transition font-medium"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Product Grid */}
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin mb-3 text-amber-700" />
                  <p className="text-sm font-medium">Carregando catálogo...</p>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="bg-white p-12 rounded-2xl text-center text-slate-400 max-w-md mx-auto border border-amber-200 shadow-2xs">
                  <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <p className="font-bold text-slate-700 mb-1">Nenhum produto encontrado</p>
                  <p className="text-xs text-slate-400">Tente buscar por outro termo ou limpe a busca.</p>
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition"
                    >
                      Limpar Busca
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-5">
                  {filteredProducts.map((product) => {
                    const isOutOfStock = product.stock !== null && product.stock !== undefined && product.stock <= 0;
                    const inCartItem = cart.find(i => i.product.id === product.id);

                    return (
                      <div 
                        key={product.id} 
                        className="bg-white rounded-2xl p-3.5 sm:p-4 border border-amber-200 shadow-2xs hover:shadow-md hover:border-amber-300 transition-all duration-200 flex flex-col justify-between group relative"
                      >
                        <div>
                          {/* Image Container with Badges */}
                          <div className="aspect-square bg-amber-50/50 rounded-xl p-2.5 mb-3 relative overflow-hidden flex items-center justify-center border border-amber-100 group-hover:bg-amber-100/40 transition-colors">
                            {product.image_url ? (
                              <img 
                                src={product.image_url} 
                                alt={product.name} 
                                className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300 drop-shadow-xs" 
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-300">
                                <Package className="w-10 h-10" />
                              </div>
                            )}

                            {/* Badge pills on image */}
                            <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
                              {product.is_approximate && (
                                <span className="bg-zinc-900/90 text-white text-xxs font-bold px-2 py-0.5 rounded-md flex items-center gap-1 shadow-xs font-mono">
                                  Fracionado
                                </span>
                              )}
                              {isOutOfStock && (
                                <span className="bg-red-500 text-white text-xxs font-bold px-2 py-0.5 rounded-md uppercase shadow-xs">
                                  Esgotado
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Product Details */}
                          <div>
                            <h3 className="font-bold text-slate-900 text-sm sm:text-base leading-snug line-clamp-2 group-hover:text-amber-800 transition-colors">
                              {product.name}
                            </h3>
                            <p className="text-xxs sm:text-xs text-slate-500 mt-1 line-clamp-1 font-medium">
                              {product.description || (product.unit === 'kg' ? 'Venda por peso' : `Por ${product.unit}`)}
                            </p>
                          </div>
                        </div>

                        {/* Price & Action Button */}
                        <div className="flex items-center justify-between mt-3.5 pt-2 border-t border-amber-100/80">
                          <div className="flex items-baseline gap-0.5">
                            <span className="text-xxs sm:text-xs font-bold text-amber-600 font-mono">R$</span>
                            <span className="font-black text-slate-900 text-base sm:text-lg font-mono">
                              {product.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>

                          <button
                            onClick={() => {
                              if (isOutOfStock) {
                                showAlert(
                                  'Produto Esgotado',
                                  'Desculpe, este produto acabou no momento. Mas não se preocupe, nosso estoque já está sendo reabastecido e logo estará disponível de novo!'
                                );
                              } else if (product.is_approximate) {
                                setWeightModalProduct(product)
                                setWeightModalValue('0.0')
                                setShowWeightModal(true)
                              } else {
                                setQtyModalProduct(product)
                                setQtyModalValue(1)
                                setShowQtyModal(true)
                              }
                            }}
                            className={`px-2.5 sm:px-3 py-2 text-xs font-bold rounded-xl transition-all active:scale-95 shrink-0 flex items-center justify-center gap-1 ${
                              isOutOfStock
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : inCartItem
                                  ? 'bg-zinc-900 text-white hover:bg-zinc-800 shadow-2xs'
                                  : 'bg-amber-600 hover:bg-amber-700 text-white shadow-2xs'
                            }`}
                            title={isOutOfStock ? 'Esgotado' : 'Adicionar ao Carrinho'}
                          >
                            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                            <span className="hidden sm:inline">{inCartItem ? 'Adicionado' : 'Adicionar'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* VIEW: CLIENT ORDERS HISTORY */}
          {clientTab === 'orders' && (
            <div className="max-w-3xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">Histórico de Pedidos</h2>
                <button
                  onClick={loadClientOrders}
                  className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition flex items-center gap-1.5 text-xs font-semibold"
                >
                  <RefreshCw className="w-4 h-4" />
                  Atualizar
                </button>
              </div>

              {/* Order status tabs */}
              <div className="flex flex-wrap gap-2 p-1 bg-slate-100 rounded-xl w-full">
                <button
                  onClick={() => setClientOrderHistoryTab('in_progress')}
                  className={`flex-1 min-w-[120px] px-3 py-2 rounded-lg font-semibold text-xs transition text-center ${clientOrderHistoryTab === 'in_progress' ? `${theme.bg} text-white shadow-sm` : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Aguardando Entrega ({clientOrders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length})
                </button>
                <button
                  onClick={() => setClientOrderHistoryTab('awaiting_payment')}
                  className={`flex-1 min-w-[120px] px-3 py-2 rounded-lg font-semibold text-xs transition text-center ${clientOrderHistoryTab === 'awaiting_payment' ? 'bg-red-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Aguardando Pagamento ({clientOrders.filter(o => o.status === 'delivered' && o.payment_status !== 'paid').length})
                </button>
                <button
                  onClick={() => setClientOrderHistoryTab('paid')}
                  className={`flex-1 min-w-[120px] px-3 py-2 rounded-lg font-semibold text-xs transition text-center ${clientOrderHistoryTab === 'paid' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Entregues e Pagos
                </button>
              </div>

              {loadingClientOrders ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin mb-3 text-indigo-500" />
                  <p className="text-sm">Carregando pedidos...</p>
                </div>
              ) : clientOrders.length === 0 ? (
                <div className={`${theme.cardBg} p-12 rounded-2xl text-center text-slate-400`}>
                  <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <p className="font-semibold text-slate-600 mb-1">Nenhum pedido realizado</p>
                  <p className="text-sm">Os pedidos deste cliente aparecerão aqui.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    const filtered = clientOrders.filter(order => {
                      if (clientOrderHistoryTab === 'in_progress') {
                        return order.status !== 'delivered';
                      } else if (clientOrderHistoryTab === 'awaiting_payment') {
                        return order.status === 'delivered' && order.payment_status !== 'paid';
                      } else if (clientOrderHistoryTab === 'paid') {
                        return order.status === 'delivered' && order.payment_status === 'paid';
                      }
                      return true;
                    });

                    if (filtered.length === 0) {
                      return (
                        <div className={`${theme.cardBg} p-12 rounded-2xl text-center text-slate-500 border border-slate-100/30`}>
                          <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                          <p className="font-semibold text-slate-600 mb-1">Nenhum pedido nesta aba</p>
                          <p className="text-sm">Os pedidos correspondentes aparecerão aqui.</p>
                        </div>
                      );
                    }

                    return filtered.map((order) => {
                    const dateFormatted = new Date(order.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
                    const isPending = order.status === 'pending'
                    const hasAppx = order.order_items.some(item => item.is_approximate)

                    const isAwaitingPayment = clientOrderHistoryTab === 'awaiting_payment'

                    return (
                      <div 
                        key={order.id} 
                        onClick={isAwaitingPayment ? () => {
                          loadTrackingOrder(order.id)
                          setPage('tracking')
                        } : undefined}
                        className={`${theme.cardBg} p-5 space-y-4 border border-transparent transition-all ${
                          isAwaitingPayment ? 'cursor-pointer hover:shadow-md hover:border-slate-200' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="space-y-0.5">
                            <span className="font-mono text-xxs bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-semibold">
                              #{order.id.substring(0, 8).toUpperCase()}
                            </span>
                            <span className="text-xs text-slate-600 block mt-1">{dateFormatted}</span>
                          </div>

                          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${order.status === 'delivered' ? 'bg-emerald-50 text-emerald-600' : order.status === 'cancelled' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                            {order.status === 'delivered' ? 'Entregue' : order.status === 'cancelled' ? 'Cancelado' : 'Aguardando Entrega'}
                          </span>
                        </div>

                        {isAwaitingPayment && (
                          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl flex items-center justify-between text-xs font-bold animate-pulse shadow-sm">
                            <span className="flex items-center gap-1.5">
                              <DollarSign className="w-4 h-4 text-amber-600" /> Clique aqui para ver o QR Code e pagar via Pix
                            </span>
                            <ChevronRight className="w-4 h-4 text-amber-600" />
                          </div>
                        )}

                        {/* Items list */}
                        <div className={`${theme.inputBg} p-4 rounded-xl divide-y ${theme.lightBorder}/40 space-y-2 border ${theme.lightBorder}/30`}>
                          {order.order_items.map((item) => {
                            const qty = item.quantity_final !== null ? item.quantity_final : item.quantity_requested
                            const unit = item.products?.unit || 'un'
                            return (
                              <div key={item.id} className="pt-2 first:pt-0 flex items-center justify-between text-xs text-slate-600">
                                <span>{formatQuantity(qty, unit)} x {item.products?.name || 'Item do pedido'}</span>
                                <span className="font-semibold text-slate-800">
                                  R$ {item.price_final !== null ? item.price_final.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (item.price_unit * qty).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            )
                          })}

                          {order.discount > 0 && (
                            <div className="pt-2 flex items-center justify-between text-emerald-600 text-xs font-semibold">
                              <span>Desconto {order.coupon_code ? `(${order.coupon_code})` : ''}:</span>
                              <span>- R$ {order.discount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          <div className="pt-3 border-t border-slate-200/50 flex items-center justify-between text-slate-800">
                            <span className="font-bold text-xs">Total {isPending && hasAppx && '(Estimado)'}</span>
                            <span className="font-bold text-sm text-slate-900">
                              R$ {order.total_price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>

                        <div className="text-xxs text-slate-600 leading-normal flex items-start gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                          <span><strong>Endereço:</strong> {order.delivery_address}</span>
                        </div>

                        {order.notes && (
                          <div className="text-xxs text-slate-600 leading-normal flex items-start gap-1 mt-1.5 bg-slate-100/70 p-2 rounded-lg border border-slate-200/40">
                            <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                            <span><strong>Observações do Pedido:</strong> {order.notes}</span>
                          </div>
                        )}

                        {/* Order evaluation */}
                        {order.status === 'delivered' && (
                          order.rating !== null && order.rating !== undefined ? (
                            <div className={`mt-3 pt-3 border-t ${theme.lightBorder} flex flex-col gap-1.5 bg-amber-50/40 p-3 rounded-xl border border-amber-100/50`}>
                              <span className="text-xxs font-bold text-amber-800 uppercase tracking-wider font-mono flex items-center gap-1">
                                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> Sua Avaliação
                              </span>
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <Star 
                                    key={star} 
                                    className={`w-3.5 h-3.5 ${star <= order.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} 
                                  />
                                ))}
                                <span className="text-xs font-semibold text-slate-600 ml-1 font-mono">{order.rating}/5</span>
                              </div>
                              {order.rating_comment && (
                                <p className="text-xs text-slate-600 italic">"{order.rating_comment}"</p>
                              )}
                            </div>
                          ) : (
                            <div className={`mt-3 pt-3 border-t ${theme.lightBorder} flex justify-end`}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setOrderToEvaluate(order)
                                  setEvaluationRating(0)
                                  setEvaluationComment('')
                                }}
                                className="py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg shadow-sm transition flex items-center gap-1.5"
                              >
                                <Star className="w-3.5 h-3.5 fill-white text-white" />
                                Avaliar Pedido
                              </button>
                            </div>
                          )
                        )}


                      </div>
                    )
                  })
                })()}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Floating Bottom Cart Bar (from Mockup Reference) */}
        {clientTab === 'catalog' && cart.length > 0 && (
          <div className="fixed bottom-5 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
            <div className="bg-zinc-900/95 backdrop-blur-md text-white rounded-full p-2 pl-5 sm:pl-6 pr-2 shadow-2xl flex items-center justify-between gap-4 max-w-md w-full pointer-events-auto border border-zinc-800 animate-slide-in">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="font-semibold text-xs sm:text-sm text-zinc-200 truncate">
                  {cart.reduce((t, i) => t + (i.product.unit === 'kg' ? 1 : i.quantity), 0)} Itens Selecionados
                </span>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="font-black text-sm sm:text-base text-white font-mono">
                  R$ {cart.reduce((t, i) => t + (i.product.price * i.quantity), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <button 
                  onClick={() => setShowCartModal(true)}
                  className="p-2.5 sm:p-3 bg-orange-500 hover:bg-orange-600 text-white rounded-full shadow-lg transition active:scale-95 flex items-center justify-center"
                  title="Finalizar Pedido"
                >
                  <ShoppingCart className="w-4.5 h-4.5 sm:w-5 sm:h-5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cart Modal / Sidebar */}
        {showCartModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
            <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl animate-slide-in">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-800 font-bold">
                  <ShoppingCart className="w-5 h-5 text-indigo-600" />
                  <span>Seu Carrinho</span>
                </div>
                <button 
                  onClick={() => setShowCartModal(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center py-12">
                    <ShoppingCart className="w-12 h-12 mb-3 text-slate-200" />
                    <p className="font-semibold text-slate-500">Seu carrinho está vazio</p>
                    <p className="text-xs">Adicione itens do catálogo para prosseguir.</p>
                  </div>
                ) : (
                  cart.map((item) => (
                    <div key={item.product.id} className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl flex gap-3">
                      <div className="w-14 h-14 rounded-lg bg-white border border-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                        {item.product.image_url ? (
                          <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-6 h-6 text-slate-300" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-slate-700 text-sm leading-tight mb-0.5">{item.product.name}</h4>
                        <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-2">
                          <span>R$ {item.product.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {item.product.unit}</span>
                          {item.product.is_approximate && (
                            <span className="text-indigo-600 font-medium bg-indigo-50 px-1 rounded text-xxs flex items-center gap-0.5 shrink-0 font-mono">
                              <Info className="w-3 h-3" /> Fracionado
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center border border-slate-200 bg-white rounded-lg px-1 py-0.5">
                            <button 
                              onClick={() => updateCartQuantity(item.product.id, -1)}
                              className="p-1 hover:bg-slate-50 rounded text-slate-500"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-xs font-semibold px-2.5 text-slate-700 min-w-8 text-center font-mono">
                              {item.product.unit === 'kg' ? `${item.quantity.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}kg` : item.quantity}
                            </span>
                            <button 
                              onClick={() => updateCartQuantity(item.product.id, 1)}
                              className="p-1 hover:bg-slate-50 rounded text-slate-500"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-slate-800 text-sm">
                              R$ {(item.product.price * item.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <button 
                              onClick={() => removeFromCart(item.product.id)}
                              className="p-1.5 hover:bg-red-50 hover:text-red-500 rounded text-slate-400 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {cart.length > 0 && (
                <div className="p-4 border-t border-slate-100 bg-slate-50 space-y-4">
                  {hasApproximateInCart() && (
                    <div className={`${theme.lightBg} ${theme.lightText} border ${theme.lightBorder} p-3 rounded-xl text-xxs flex items-start gap-2`}>
                      <Info className={`w-4 h-4 shrink-0 mt-0.5 ${theme.iconColor}`} />
                      <span>
                        <strong>Aviso de Produto Fracionado:</strong> Seu carrinho possui itens vendidos por peso. O valor final será ajustado após a pesagem no estabelecimento.
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-slate-800">
                    <span className="font-semibold text-sm">Total {hasApproximateInCart() && '(Estimado)'}</span>
                    <span className="font-bold text-lg text-slate-900">
                      R$ {getCartTotal().toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      setShowCartModal(false)
                      setPage('checkout')
                    }}
                    className={`w-full py-3.5 ${theme.bg} ${theme.hoverBg} text-white font-semibold rounded-xl text-sm transition flex items-center justify-center gap-2`}
                  >
                    Confirmar Pedido
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MODAL: EDIT PROFILE */}
        {showEditProfileModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <form onSubmit={handleSaveProfile} className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 animate-scale-in max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                  <User className={`w-5 h-5 ${theme.text}`} />
                  Editar Cadastro
                </h3>
                <button 
                  type="button"
                  onClick={() => setShowEditProfileModal(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Nome Completo</label>
                  <input
                    type="text"
                    required
                    value={profileForm.name}
                    onChange={(e) => setProfileForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Telefone (WhatsApp)</label>
                  <input
                    type="text"
                    required
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm(prev => ({ ...prev, phone: e.target.value.replace(/\D/g, '') }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 relative">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">CEP</label>
                    <input
                      type="text"
                      required
                      placeholder="00000-000"
                      value={getFormattedCep(profileForm.cep)}
                      onChange={handleProfileCepChange}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                    />
                    {cepLoading && (
                      <span className="absolute right-3.5 bottom-3">
                        <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Estado</label>
                    <input
                      type="text"
                      required
                      placeholder="UF"
                      value={profileForm.state}
                      onChange={(e) => setProfileForm(prev => ({ ...prev, state: e.target.value.toUpperCase() }))}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Cidade</label>
                    <input
                      type="text"
                      required
                      value={profileForm.city}
                      onChange={(e) => setProfileForm(prev => ({ ...prev, city: e.target.value }))}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Número</label>
                    <input
                      type="text"
                      required
                      value={profileForm.number}
                      onChange={(e) => setProfileForm(prev => ({ ...prev, number: e.target.value }))}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Rua / Logradouro</label>
                  <input
                    type="text"
                    required
                    value={profileForm.street}
                    onChange={(e) => setProfileForm(prev => ({ ...prev, street: e.target.value }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Bairro</label>
                  <input
                    type="text"
                    required
                    value={profileForm.neighborhood}
                    onChange={(e) => setProfileForm(prev => ({ ...prev, neighborhood: e.target.value }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Complemento</label>
                  <input
                    type="text"
                    placeholder="Ex: Apto 101, Bloco B"
                    value={profileForm.complement}
                    onChange={(e) => setProfileForm(prev => ({ ...prev, complement: e.target.value }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none"
                  />
                </div>

                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentPasswordInput('')
                      setNewPasswordInput('')
                      setNewPasswordConfirmInput('')
                      setShowChangePasswordModal(true)
                    }}
                    className="w-full py-2.5 px-3 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
                  >
                    <Key className="w-4 h-4 text-amber-700" />
                    <span>Alterar Senha de Acesso</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setProfileSecurityQuestion(user?.security_question || SECURITY_QUESTIONS[0])
                      setProfileSecurityAnswer('')
                      setShowChangeSecurityQuestionModal(true)
                    }}
                    className="w-full py-2.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
                  >
                    <Lock className="w-4 h-4 text-indigo-700" />
                    <span>Alterar Pergunta e Resposta Secreta</span>
                  </button>
                </div>
              </div>

              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditProfileModal(false)}
                  className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-500 font-semibold rounded-xl text-xs transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className={`flex-1 py-3 text-white font-semibold rounded-xl text-xs transition shadow-sm ${theme.bg} ${theme.hoverBg}`}
                >
                  Salvar Cadastro
                </button>
              </div>
            </form>
          </div>
        )}

        {/* MODAL: CHANGE PASSWORD (IN PROFILE) */}
        {showChangePasswordModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <form onSubmit={handleChangePasswordInProfile} className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4 animate-scale-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                  <Lock className="w-5 h-5 text-amber-600" />
                  Alterar Senha de Acesso
                </h3>
                <button
                  type="button"
                  onClick={() => setShowChangePasswordModal(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {user?.password_hash && (
                  <div>
                    <label className="block text-xxs font-bold text-slate-500 uppercase tracking-wider mb-1 font-mono">Senha Atual</label>
                    <div className="relative">
                      <input
                        type={showCurrentPassword ? "text" : "password"}
                        placeholder="Digite sua senha atual"
                        value={currentPasswordInput}
                        onChange={(e) => setCurrentPasswordInput(e.target.value)}
                        className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 font-medium"
                        required
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                        title={showCurrentPassword ? "Ocultar" : "Ver"}
                      >
                        {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xxs font-bold text-slate-500 uppercase tracking-wider mb-1 font-mono">Nova Senha</label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      placeholder="Mínimo 4 caracteres"
                      value={newPasswordInput}
                      onChange={(e) => setNewPasswordInput(e.target.value)}
                      className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 font-medium"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                      title={showNewPassword ? "Ocultar" : "Ver"}
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xxs font-bold text-slate-500 uppercase tracking-wider mb-1 font-mono">Confirmar Nova Senha</label>
                  <div className="relative">
                    <input
                      type={showNewPasswordConfirm ? "text" : "password"}
                      placeholder="Repita a nova senha"
                      value={newPasswordConfirmInput}
                      onChange={(e) => setNewPasswordConfirmInput(e.target.value)}
                      className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 font-medium"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPasswordConfirm(!showNewPasswordConfirm)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                      title={showNewPasswordConfirm ? "Ocultar" : "Ver"}
                    >
                      {showNewPasswordConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowChangePasswordModal(false)}
                  className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-500 font-semibold rounded-xl text-xs transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={adminLoading}
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition shadow-sm disabled:opacity-50"
                >
                  {adminLoading ? 'Salvando...' : 'Salvar Senha'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* MODAL: CHANGE SECURITY QUESTION (IN PROFILE) */}
        {showChangeSecurityQuestionModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <form onSubmit={handleChangeSecurityQuestionInProfile} className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4 animate-scale-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                  <Key className="w-5 h-5 text-indigo-600" />
                  Pergunta de Segurança
                </h3>
                <button
                  type="button"
                  onClick={() => setShowChangeSecurityQuestionModal(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-xxs font-bold text-slate-500 uppercase tracking-wider mb-1 font-mono">Escolha a Pergunta</label>
                  <select
                    value={profileSecurityQuestion}
                    onChange={(e) => setProfileSecurityQuestion(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-xs font-medium"
                  >
                    {SECURITY_QUESTIONS.map((q, idx) => (
                      <option key={idx} value={q}>{q}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xxs font-bold text-slate-500 uppercase tracking-wider mb-1 font-mono">Nova Resposta Secreta</label>
                  <input
                    type="text"
                    placeholder="Ex: Maria, Azul, Gol..."
                    value={profileSecurityAnswer}
                    onChange={(e) => setProfileSecurityAnswer(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-xs font-medium"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowChangeSecurityQuestionModal(false)}
                  className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-500 font-semibold rounded-xl text-xs transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={adminLoading}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-sm disabled:opacity-50"
                >
                  {adminLoading ? 'Salvando...' : 'Salvar Pergunta'}
                </button>
              </div>
            </form>
          </div>
        )}



        {/* MODAL: INPUT WEIGHT FOR FRACTIONAL PRODUCTS */}
        {showWeightModal && weightModalProduct && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-4 animate-scale-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Adicionar ao Pedido</h3>
                  <p className="text-xxs text-slate-400 font-medium">Informe a quantidade por peso (kg)</p>
                </div>
                <button 
                  onClick={() => {
                    setShowWeightModal(false)
                    setWeightModalProduct(null)
                  }}
                  className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-400 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Product Info Row */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-150">
                {weightModalProduct.image_url ? (
                  <img src={weightModalProduct.image_url} alt={weightModalProduct.name} className="w-12 h-12 rounded-lg object-contain bg-white p-1 border border-slate-100 shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center text-slate-300 shrink-0 border border-slate-100">
                    <Package className="w-6 h-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-800 text-sm truncate">{weightModalProduct.name}</h4>
                  <p className="text-xs text-slate-500 font-medium">
                    R$ {weightModalProduct.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / kg
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 flex flex-col items-center gap-2.5">
                <label className="text-xxs font-bold text-slate-400 uppercase tracking-wider font-mono">Quantidade Desejada (Kg)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    pattern="[0-9]*[.,]?[0-9]*"
                    value={weightModalValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '' || /^[0-9]*[.,]?[0-9]*$/.test(val)) {
                        setWeightModalValue(val);
                      }
                    }}
                    onFocus={(e) => e.target.select()}
                    className="w-32 px-3 py-2 text-center border border-slate-300 bg-white rounded-xl text-slate-900 font-black font-mono text-xl focus:outline-none focus:ring-2 focus:ring-zinc-900/20 focus:border-zinc-900 shadow-2xs"
                    placeholder="0.0"
                  />
                  <span className="text-sm font-black text-slate-600 font-mono">Kg</span>
                </div>
                <div className="text-xs text-slate-500 font-medium pt-1 border-t border-slate-200/60 w-full text-center">
                  Total Estimado: <strong className="text-slate-900 font-black font-mono">R$ {(() => {
                    const parsed = parseFloat(weightModalValue.replace(',', '.')) || 0;
                    return (parsed * weightModalProduct.price).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  })()}</strong>
                </div>
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowWeightModal(false)
                    setWeightModalProduct(null)
                  }}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleWeightConfirm}
                  className="flex-1 py-3 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold rounded-xl transition shadow-sm active:scale-95"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: INPUT QUANTITY FOR UNIT PRODUCTS */}
        {showQtyModal && qtyModalProduct && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-4 animate-scale-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-extrabold text-slate-900 text-base">Adicionar ao Pedido</h3>
                  <p className="text-xxs text-slate-400 font-medium">Selecione a quantidade desejada</p>
                </div>
                <button 
                  onClick={() => {
                    setShowQtyModal(false)
                    setQtyModalProduct(null)
                  }}
                  className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-400 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Product Info Row */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-150">
                {qtyModalProduct.image_url ? (
                  <img src={qtyModalProduct.image_url} alt={qtyModalProduct.name} className="w-12 h-12 rounded-lg object-contain bg-white p-1 border border-slate-100 shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-white flex items-center justify-center text-slate-300 shrink-0 border border-slate-100">
                    <Package className="w-6 h-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-slate-800 text-sm truncate">{qtyModalProduct.name}</h4>
                  <p className="text-xs text-slate-500 font-medium">
                    R$ {qtyModalProduct.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {qtyModalProduct.unit}
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 flex flex-col items-center gap-3">
                <span className="text-xxs font-bold text-slate-400 uppercase tracking-wider font-mono">Unidades</span>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setQtyModalValue(prev => Math.max(1, prev - 1))}
                    className="w-11 h-11 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl flex items-center justify-center text-slate-700 font-bold transition active:scale-95 shadow-2xs"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-2xl font-black text-slate-900 min-w-12 text-center font-mono">
                    {qtyModalValue}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQtyModalValue(prev => prev + 1)}
                    className="w-11 h-11 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl flex items-center justify-center text-slate-700 font-bold transition active:scale-95 shadow-2xs"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-xs text-slate-500 font-medium pt-1 border-t border-slate-200/60 w-full text-center">
                  Total: <strong className="text-slate-900 font-black font-mono">R$ {(qtyModalValue * qtyModalProduct.price).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </div>
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowQtyModal(false)
                    setQtyModalProduct(null)
                  }}
                  className="flex-1 py-3 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleQtyModalConfirm}
                  className="flex-1 py-3 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold rounded-xl transition shadow-sm active:scale-95"
                >
                  Adicionar ao Carrinho
                </button>
              </div>
            </div>
          </div>
        )}


      </div>
    )
  }

  // 3. CHECKOUT PAGE (CLIENT / IMPERSONATED CLIENT)
  if (page === 'checkout') {
    return (
      <div className={`min-h-screen ${theme.pageBg} flex flex-col`}>
        {/* Impersonation Warning Banner */}
        {isAdminImpersonating && (
          <div className="bg-amber-500 text-white py-2.5 px-4 font-semibold text-xs sm:text-sm shadow-md flex items-center justify-between sticky top-0 z-50">
            <div className="flex items-center gap-2 max-w-xl truncate">
              <User className="w-4 h-4 text-amber-100 shrink-0" />
              <span>Fazendo pedido em nome de: <strong className="text-white underline">{user.name}</strong> ({getFormattedPhone(user.phone)})</span>
            </div>
            <button
              onClick={handleStopImpersonating}
              className="px-3 py-1.5 bg-white hover:bg-slate-50 text-amber-800 rounded-lg text-xs font-bold transition shrink-0 shadow-sm"
            >
              Voltar ao Painel Admin
            </button>
          </div>
        )}

        {/* Header */}
        <header className={`${theme.headerBg} sticky top-0 z-40`}>
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
            <button 
              onClick={() => setPage('catalog')}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition font-medium text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar ao Catálogo
            </button>
            <span className="font-bold text-slate-800 text-base">Finalizar Pedido</span>
            <div className="w-20"></div> {/* Spacer */}
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
          <div className={`${theme.cardBg} p-6 space-y-6`}>
            <h2 className="text-xl font-bold text-slate-800 border-b border-slate-50 pb-3 flex items-center gap-2">
              <MapPin className={`w-5 h-5 ${theme.text}`} />
              Endereço de Entrega
            </h2>

            {checkoutError && (
              <div className="bg-red-50 text-red-600 p-3.5 rounded-xl text-xs border border-red-100 flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}

            <form onSubmit={handleCheckoutSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">CEP</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="00000-000"
                      value={getFormattedCep(cep)}
                      onChange={handleCepChange}
                      maxLength="9"
                      className={`w-full px-4 py-2.5 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition font-medium font-mono text-sm`}
                      required
                    />
                    {cepLoading && (
                      <RefreshCw className={`absolute right-3.5 top-3.5 w-4 h-4 ${theme.text} animate-spin`} />
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Rua / Logradouro</label>
                  <input
                    type="text"
                    placeholder="Nome da rua"
                    value={street}
                    onChange={(e) => setStreet(e.target.value)}
                    className={`w-full px-4 py-2.5 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition text-sm`}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Número</label>
                  <input
                    type="text"
                    placeholder="Nº 123"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    className={`w-full px-4 py-2.5 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition text-sm`}
                    required
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Complemento / Apto</label>
                  <input
                    type="text"
                    placeholder="Ap 302, Bloco B (Opcional)"
                    value={complement}
                    onChange={(e) => setComplement(e.target.value)}
                    className={`w-full px-4 py-2.5 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition text-sm`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Bairro</label>
                  <input
                    type="text"
                    placeholder="Bairro"
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    className={`w-full px-4 py-2.5 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition text-sm`}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Cidade</label>
                  <input
                    type="text"
                    placeholder="Cidade"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className={`w-full px-4 py-2.5 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition text-sm`}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Estado (UF)</label>
                  <input
                    type="text"
                    placeholder="PB"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    maxLength="2"
                    className={`w-full px-4 py-2.5 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition text-sm`}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Observações do Pedido</label>
                <textarea
                  placeholder="Instruções para a entrega, ponto de referência, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows="3"
                  className={`w-full px-4 py-2.5 ${theme.inputBg} border ${theme.lightBorder} rounded-xl text-slate-800 focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder} transition text-sm`}
                ></textarea>
              </div>

              {/* Cupom de Desconto */}
              <div className={`${theme.inputBg} border ${theme.lightBorder} p-4 rounded-2xl space-y-3 mt-6`}>
                <span className="block text-xs font-semibold text-slate-600 uppercase tracking-wider font-mono">Cupom de Desconto</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="DIGITE SEU CUPOM"
                    value={couponCodeInput}
                    onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())}
                    className="flex-1 px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-xs font-bold uppercase font-mono"
                    disabled={!!appliedCoupon}
                  />
                  {appliedCoupon ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAppliedCoupon(null)
                        setCouponCodeInput('')
                        addToast('Cupom removido!', 'info')
                      }}
                      className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-650 text-xs font-bold rounded-xl transition border border-red-200"
                    >
                      Remover
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleApplyCoupon}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-750 text-white text-xs font-bold rounded-xl transition shadow-xs"
                    >
                      Aplicar
                    </button>
                  )}
                </div>
                {appliedCoupon && (
                  <p className="text-xxs text-emerald-600 font-semibold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    Cupom <strong>{appliedCoupon.code}</strong> aplicado com sucesso!
                  </p>
                )}
              </div>

              {/* Order summary */}
              <div className={`${theme.inputBg} border ${theme.lightBorder} p-4 rounded-2xl space-y-3 mt-6`}>
                <span className="block text-xs font-semibold text-slate-600 uppercase tracking-wider font-mono">Itens Escolhidos</span>
                <div className="divide-y divide-slate-150 max-h-40 overflow-y-auto">
                  {cart.map(item => (
                    <div key={item.product.id} className="py-2 flex items-center justify-between text-slate-700 text-xs">
                      <span>{formatQuantity(item.quantity, item.product.unit)} x {item.product.name}</span>
                      <span className="font-semibold">R$ {(item.product.price * item.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                </div>

                {(() => {
                  const subtotal = getCartTotal()
                  const discount = appliedCoupon ? appliedCoupon.discountAmount : 0
                  const finalTotal = Math.max(0, subtotal - discount)
                  return (
                    <div className="border-t border-slate-200/50 pt-3 space-y-1.5 text-slate-800">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span>Subtotal:</span>
                        <span>R$ {subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      {discount > 0 && (
                        <div className="flex items-center justify-between text-emerald-600 text-xs font-semibold">
                          <span>Desconto ({appliedCoupon.code}):</span>
                          <span>- R$ {discount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-bold text-sm">
                        <span>Preço Total {hasApproximateInCart() && '(Estimado)'}</span>
                        <span className="text-base text-slate-900">R$ {finalTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>

              <button
                type="submit"
                disabled={loading}
                className={`w-full mt-6 py-4 text-white font-semibold rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2 disabled:opacity-55 ${theme.shadowColor} ${theme.bg} ${theme.hoverBg}`}
              >
                {loading ? 'Enviando pedido...' : 'Confirmar e Enviar Pedido'}
                <Check className="w-5 h-5" />
              </button>
            </form>
          </div>
        </main>
      </div>
    )
  }

  // 4. SUCCESS PAGE (CLIENT / IMPERSONATED CLIENT)
  if (page === 'success') {
    return (
      <div className={`min-h-screen ${theme.pageBg} flex items-center justify-center p-4`}>
        {/* Impersonation Warning Banner */}
        {isAdminImpersonating && (
          <div className="bg-amber-500 text-white py-2.5 px-4 font-semibold text-xs sm:text-sm shadow-md flex items-center justify-between absolute top-0 left-0 right-0 z-50">
            <div className="flex items-center gap-2 max-w-xl truncate">
              <User className="w-4 h-4 text-amber-100 shrink-0" />
              <span>Pedido realizado em nome de: <strong>{user.name}</strong></span>
            </div>
            <button
              onClick={handleStopImpersonating}
              className="px-3 py-1.5 bg-white hover:bg-slate-50 text-amber-800 rounded-lg text-xs font-bold transition shrink-0 shadow-sm"
            >
              Voltar ao Painel Admin
            </button>
          </div>
        )}

        <div className={`${theme.cardBg} p-8 rounded-2xl max-w-md w-full text-center`}>
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-emerald-100 text-emerald-600 rounded-full">
              <Check className="w-10 h-10" />
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 mb-2">Pedido Enviado!</h2>
          <p className="text-slate-600 text-sm mb-6 leading-relaxed">
            O pedido <span className={`font-mono bg-slate-100 px-1.5 py-0.5 rounded font-semibold ${theme.text} text-xs`}>#{createdOrderId.substring(0,8).toUpperCase()}</span> foi recebido com sucesso. 
            Está em processamento e o estabelecimento entrará em contato via WhatsApp para finalizar a entrega.
          </p>

          <div className={`${theme.inputBg} border ${theme.lightBorder} p-4 rounded-2xl text-left text-xs text-slate-500 space-y-2 mb-6`}>
            {whatHappensNowText.split('\n').filter(line => line.trim() !== '').map((line, idx) => {
              if (idx === 0 || line.toLowerCase().includes('o que acontece agora')) {
                return <p key={idx} className="font-semibold text-slate-600">{line}</p>
              }
              return <p key={idx}>{line}</p>
            })}
          </div>
          <div className="pt-6">
            {isAdminImpersonating ? (
              <button
                onClick={handleStopImpersonating}
                className={`w-full py-3.5 text-white font-semibold rounded-xl text-sm transition ${theme.bg} ${theme.hoverBg}`}
              >
                Concluir e Voltar ao Painel Admin
              </button>
            ) : (
              <button
                onClick={() => {
                  setCart([])
                  setClientOrderHistoryTab('in_progress') // Garante o direcionamento para 'Aguardando Entrega'
                  setClientTab('orders') // take them to history to see it
                  loadClientOrders()
                  setPage('catalog')
                }}
                className={`w-full py-3.5 text-white font-semibold rounded-xl text-sm transition ${theme.bg} ${theme.hoverBg}`}
              >
                Acompanhar Meus Pedidos
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // 5. ADMIN PAGE (OWNER)
  if (page === 'admin') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        {/* Admin Header */}
        <header className="bg-slate-900 text-white sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <div 
              onClick={() => {
                setAdminTab('orders')
                setAdminOrderSubTab('pending')
                setOrderSearchQuery('')
              }}
              className="flex items-center gap-3 cursor-pointer hover:opacity-90 transition"
              title="Ir para Todos os Pedidos (Início)"
            >
              <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-sm">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-white text-base block">ClickEntregas Painel</span>
                <span className="text-xxs text-slate-400 block font-mono">Usuário: {user.name}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => setPage('catalog')}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-white transition flex items-center gap-2 text-xs font-semibold shadow-md shadow-indigo-900/30"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Ver como Cliente</span>
              </button>
              <button 
                onClick={triggerLogout}
                className="p-2.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition flex items-center gap-2 text-xs font-semibold"
              >
                <LogOut className="w-4 h-4" />
                Sair
              </button>
            </div>
          </div>
          
          {/* Mobile Admin Menu Button & Current Tab */}
          <div className="md:hidden border-t border-slate-800 px-4 py-3 flex items-center justify-between">
            <span className="text-slate-300 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              {adminTab === 'orders' && <><FileText className="w-4.5 h-4.5 text-indigo-400" /> Todos os Pedidos</>}
              {adminTab === 'products' && <><Package className="w-4.5 h-4.5 text-indigo-400" /> Gerenciar Produtos</>}
              {adminTab === 'customers' && <><User className="w-4.5 h-4.5 text-indigo-400" /> Clientes</>}
              {adminTab === 'abandoned_carts' && <><ShoppingCart className="w-4.5 h-4.5 text-indigo-400" /> Carrinhos Não Finalizados</>}
              {adminTab === 'coupons' && <><Tag className="w-4.5 h-4.5 text-indigo-400" /> Cupons de Desconto</>}
              {adminTab === 'settings' && <><Settings className="w-4.5 h-4.5 text-indigo-400" /> Configurações Msg</>}
              {adminTab === 'financeiro' && <><TrendingUp className="w-4.5 h-4.5 text-indigo-400" /> Financeiro</>}
              {adminTab === 'customize' && <><Edit className="w-4.5 h-4.5 text-indigo-400" /> Editar Página</>}
              {adminTab === 'profile' && <><User className="w-4.5 h-4.5 text-indigo-400" /> Meu Perfil</>}
            </span>
            
            <button
              onClick={() => setMobileAdminMenuOpen(!mobileAdminMenuOpen)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition flex items-center gap-1 text-xs font-semibold"
            >
              <span>Menu</span>
              {mobileAdminMenuOpen ? <X className="w-4 h-4 text-indigo-400" /> : <ChevronRight className="w-4 h-4 rotate-90 text-indigo-400" />}
            </button>
          </div>

          {/* Mobile Admin Dropdown Menu */}
          {mobileAdminMenuOpen && (
            <div className="md:hidden border-t border-slate-850 bg-slate-900 px-4 py-2 space-y-1 animate-fade-in">
              <button
                onClick={() => { setAdminTab('orders'); setMobileAdminMenuOpen(false); }}
                className={`w-full py-3 px-4.5 text-left font-semibold text-xs transition uppercase tracking-wider flex items-center gap-3 rounded-xl ${adminTab === 'orders' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                <FileText className="w-4 h-4" />
                Todos os Pedidos
              </button>
              <button
                onClick={() => { setAdminTab('products'); setMobileAdminMenuOpen(false); }}
                className={`w-full py-3 px-4.5 text-left font-semibold text-xs transition uppercase tracking-wider flex items-center gap-3 rounded-xl ${adminTab === 'products' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                <Package className="w-4 h-4" />
                Gerenciar Produtos
              </button>
              <button
                onClick={() => { setAdminTab('customers'); setMobileAdminMenuOpen(false); }}
                className={`w-full py-3 px-4.5 text-left font-semibold text-xs transition uppercase tracking-wider flex items-center gap-3 rounded-xl ${adminTab === 'customers' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                <User className="w-4 h-4" />
                <span className="flex-1">Clientes</span>
                {adminCustomers.some(c => c.profile_updated_pending) && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                )}
              </button>
              <button
                onClick={() => { setAdminTab('abandoned_carts'); setMobileAdminMenuOpen(false); }}
                className={`w-full py-3 px-4.5 text-left font-semibold text-xs transition uppercase tracking-wider flex items-center gap-3 rounded-xl ${adminTab === 'abandoned_carts' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                <ShoppingCart className="w-4 h-4" />
                <span className="flex-1">Carrinhos</span>
                {adminCustomers.filter(c => c.active_cart && Array.isArray(c.active_cart) && c.active_cart.length > 0 && c.cart_updated_at && (Date.now() - new Date(c.cart_updated_at).getTime()) >= 15 * 60 * 1000).length > 0 && (
                  <span className="px-2 py-0.5 bg-amber-500 text-white rounded-full text-xxs font-bold animate-pulse">
                    {adminCustomers.filter(c => c.active_cart && Array.isArray(c.active_cart) && c.active_cart.length > 0 && c.cart_updated_at && (Date.now() - new Date(c.cart_updated_at).getTime()) >= 15 * 60 * 1000).length}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setAdminTab('coupons'); setMobileAdminMenuOpen(false); }}
                className={`w-full py-3 px-4.5 text-left font-semibold text-xs transition uppercase tracking-wider flex items-center gap-3 rounded-xl ${adminTab === 'coupons' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                <Tag className="w-4 h-4" />
                Cupons de Desconto
              </button>
              <button
                onClick={() => { setAdminTab('settings'); setMobileAdminMenuOpen(false); }}
                className={`w-full py-3 px-4.5 text-left font-semibold text-xs transition uppercase tracking-wider flex items-center gap-3 rounded-xl ${adminTab === 'settings' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                <Settings className="w-4 h-4" />
                Configurações Msg
              </button>
              <button
                onClick={() => { setAdminTab('financeiro'); setMobileAdminMenuOpen(false); }}
                className={`w-full py-3 px-4.5 text-left font-semibold text-xs transition uppercase tracking-wider flex items-center gap-3 rounded-xl ${adminTab === 'financeiro' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                <TrendingUp className="w-4 h-4" />
                Financeiro
              </button>
              <button
                onClick={() => { setAdminTab('customize'); setMobileAdminMenuOpen(false); }}
                className={`w-full py-3 px-4.5 text-left font-semibold text-xs transition uppercase tracking-wider flex items-center gap-3 rounded-xl ${adminTab === 'customize' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                <Edit className="w-4 h-4" />
                Editar Página
              </button>
              <button
                onClick={() => { setAdminTab('profile'); setMobileAdminMenuOpen(false); }}
                className={`w-full py-3 px-4.5 text-left font-semibold text-xs transition uppercase tracking-wider flex items-center gap-3 rounded-xl ${adminTab === 'profile' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                <User className="w-4 h-4" />
                Meu Perfil
              </button>
            </div>
          )}

          {/* Desktop Admin Tabs */}
          <div className="hidden md:block border-t border-slate-800 max-w-6xl mx-auto px-4">
            <nav className="flex gap-6 flex-wrap">
              <button
                onClick={() => setAdminTab('orders')}
                className={`py-3.5 border-b-2 font-semibold text-xs transition uppercase tracking-wider flex items-center gap-2 ${adminTab === 'orders' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <FileText className="w-4 h-4" />
                Todos os Pedidos
              </button>
              <button
                onClick={() => setAdminTab('products')}
                className={`py-3.5 border-b-2 font-semibold text-xs transition uppercase tracking-wider flex items-center gap-2 ${adminTab === 'products' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <Package className="w-4 h-4" />
                Gerenciar Produtos
              </button>
              <button
                onClick={() => setAdminTab('customers')}
                className={`py-3.5 border-b-2 font-semibold text-xs transition uppercase tracking-wider flex items-center gap-2 ${adminTab === 'customers' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <User className="w-4 h-4" />
                <span>Clientes</span>
                {adminCustomers.some(c => c.profile_updated_pending) && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" title="Novas atualizações de cadastro!" />
                )}
              </button>
              <button
                onClick={() => setAdminTab('abandoned_carts')}
                className={`py-3.5 border-b-2 font-semibold text-xs transition uppercase tracking-wider flex items-center gap-2 ${adminTab === 'abandoned_carts' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Carrinhos</span>
                {adminCustomers.filter(c => c.active_cart && Array.isArray(c.active_cart) && c.active_cart.length > 0 && c.cart_updated_at && (Date.now() - new Date(c.cart_updated_at).getTime()) >= 15 * 60 * 1000).length > 0 && (
                  <span className="px-1.5 py-0.5 bg-amber-500 text-white rounded-full text-xxs font-bold animate-pulse" title="Carrinhos não finalizados (+15 min)">
                    {adminCustomers.filter(c => c.active_cart && Array.isArray(c.active_cart) && c.active_cart.length > 0 && c.cart_updated_at && (Date.now() - new Date(c.cart_updated_at).getTime()) >= 15 * 60 * 1000).length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setAdminTab('coupons')}
                className={`py-3.5 border-b-2 font-semibold text-xs transition uppercase tracking-wider flex items-center gap-2 ${adminTab === 'coupons' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <Tag className="w-4 h-4" />
                Cupons
              </button>
              <button
                onClick={() => setAdminTab('settings')}
                className={`py-3.5 border-b-2 font-semibold text-xs transition uppercase tracking-wider flex items-center gap-2 ${adminTab === 'settings' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <Settings className="w-4 h-4" />
                Configurações Msg
              </button>
              <button
                onClick={() => setAdminTab('financeiro')}
                className={`py-3.5 border-b-2 font-semibold text-xs transition uppercase tracking-wider flex items-center gap-2 ${adminTab === 'financeiro' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <TrendingUp className="w-4 h-4" />
                Financeiro
              </button>
              <button
                onClick={() => setAdminTab('customize')}
                className={`py-3.5 border-b-2 font-semibold text-xs transition uppercase tracking-wider flex items-center gap-2 ${adminTab === 'customize' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <Edit className="w-4 h-4" />
                Editar Página
              </button>
              <button
                onClick={() => setAdminTab('profile')}
                className={`py-3.5 border-b-2 font-semibold text-xs transition uppercase tracking-wider flex items-center gap-2 ${adminTab === 'profile' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <User className="w-4 h-4" />
                Meu Perfil
              </button>
            </nav>
          </div>
        </header>

        {/* Admin Content */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
          {adminLoading && (
            <div className="bg-slate-900/10 fixed inset-0 flex items-center justify-center z-50">
              <div className="bg-white p-5 rounded-2xl shadow-xl flex items-center gap-3">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
                <span className="text-sm font-semibold text-slate-700">Processando...</span>
              </div>
            </div>
          )}

          {/* TAB 1: ORDERS */}
          {adminTab === 'orders' && (() => {
            const uniqueOrderGroups = Array.from(new Set(adminCustomers.map(c => c.group_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
            return (
              <div className="space-y-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <h2 className="text-xl font-bold text-slate-800">Pedidos no Sistema</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setItemReportFilter('current')
                      setShowItemReportModal(true)
                    }}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition flex items-center gap-1.5 text-xs font-semibold shadow-xs"
                  >
                    <ClipboardList className="w-4 h-4" />
                    Relatório de Itens
                  </button>
                  <button
                    onClick={loadAdminOrders}
                    className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition flex items-center gap-1.5 text-xs font-semibold"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Atualizar
                  </button>
                </div>
              </div>

              {/* Order Filtering and Tabs */}
              <div className="flex flex-col sm:flex-row gap-4 justify-between items-stretch sm:items-center bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
                  <button
                    onClick={() => setAdminOrderSubTab('pending')}
                    className={`px-4 py-2 rounded-lg font-semibold text-xs transition ${adminOrderSubTab === 'pending' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Entrega Pendente ({orders.filter(o => o.status !== 'delivered' && !o.is_assembled).length})
                  </button>
                  <button
                    onClick={() => setAdminOrderSubTab('assembled')}
                    className={`px-4 py-2 rounded-lg font-semibold text-xs transition ${adminOrderSubTab === 'assembled' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Montados ({orders.filter(o => o.status !== 'delivered' && o.is_assembled).length})
                  </button>
                  <button
                    onClick={() => setAdminOrderSubTab('delivered')}
                    className={`px-4 py-2 rounded-lg font-semibold text-xs transition ${adminOrderSubTab === 'delivered' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Entregues ({orders.filter(o => o.status === 'delivered').length})
                  </button>
                </div>

                <div className="flex flex-wrap flex-1 max-w-xl gap-3 items-center justify-end">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar por nome do cliente..."
                      value={orderSearchQuery}
                      onChange={(e) => setOrderSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-sm"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={adminOrderGroupFilter}
                      onChange={(e) => setAdminOrderGroupFilter(e.target.value)}
                      className="text-xs font-semibold bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="all">Todos os Grupos</option>
                      <option value="none">Sem Grupo</option>
                      {uniqueOrderGroups.map((g, idx) => (
                        <option key={idx} value={g}>{g}</option>
                      ))}
                    </select>
                    {adminOrderGroupFilter !== 'all' && (
                      <button
                        onClick={() => setAdminOrderGroupFilter('all')}
                        className="text-xxs text-red-650 hover:text-red-800 font-bold uppercase tracking-wider transition shrink-0 font-mono"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Subdivision for Delivered Orders: Paid vs. Awaiting Payment */}
              {adminOrderSubTab === 'delivered' && (
                <div className="flex gap-2 p-1.5 bg-slate-100 rounded-xl w-fit border border-slate-200/40">
                  <button
                    onClick={() => setAdminOrderPaymentFilter('all')}
                    className={`px-3 py-1.5 rounded-lg font-bold text-xxs uppercase tracking-wider transition ${adminOrderPaymentFilter === 'all' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Todos ({orders.filter(o => o.status === 'delivered').length})
                  </button>
                  <button
                    onClick={() => setAdminOrderPaymentFilter('pending')}
                    className={`px-3 py-1.5 rounded-lg font-bold text-xxs uppercase tracking-wider transition ${adminOrderPaymentFilter === 'pending' ? 'bg-white text-red-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Pagamento Pendente ({orders.filter(o => o.status === 'delivered' && o.payment_status !== 'paid').length})
                  </button>
                  <button
                    onClick={() => setAdminOrderPaymentFilter('paid')}
                    className={`px-3 py-1.5 rounded-lg font-bold text-xxs uppercase tracking-wider transition ${adminOrderPaymentFilter === 'paid' ? 'bg-white text-emerald-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Pagos ({orders.filter(o => o.status === 'delivered' && o.payment_status === 'paid').length})
                  </button>
                </div>
              )}

              {orders.length === 0 ? (
                <div className="bg-white p-12 rounded-2xl border border-slate-100 text-center text-slate-400 max-w-md mx-auto">
                  <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <p className="font-semibold text-slate-600 mb-1">Sem pedidos no momento</p>
                  <p className="text-sm">Novos pedidos aparecerão automaticamente em tempo real.</p>
                </div>
              ) : (
                (() => {
                  const filteredOrders = orders.filter((order) => {
                    let matchesTab = false;
                    if (adminOrderSubTab === 'pending') {
                      matchesTab = order.status !== 'delivered' && !order.is_assembled;
                    } else if (adminOrderSubTab === 'assembled') {
                      matchesTab = order.status !== 'delivered' && order.is_assembled;
                    } else if (adminOrderSubTab === 'delivered') {
                      matchesTab = order.status === 'delivered';
                    }
                    const clientName = order.customers?.name || '';
                    const matchesSearch = clientName.toLowerCase().includes(orderSearchQuery.toLowerCase());
                    
                    let matchesPayment = true;
                    if (adminOrderSubTab === 'delivered') {
                      if (adminOrderPaymentFilter === 'paid') {
                        matchesPayment = order.payment_status === 'paid';
                      } else if (adminOrderPaymentFilter === 'pending') {
                        matchesPayment = order.payment_status !== 'paid';
                      }
                    }

                    let matchesGroup = true;
                    if (adminOrderGroupFilter === 'none') {
                      matchesGroup = !order.customers?.group_name;
                    } else if (adminOrderGroupFilter !== 'all') {
                      matchesGroup = order.customers?.group_name && order.customers.group_name.trim().toLowerCase() === adminOrderGroupFilter.trim().toLowerCase();
                    }
                    
                    return matchesTab && matchesSearch && matchesPayment && matchesGroup;
                  });

                  if (filteredOrders.length === 0) {
                    return (
                      <div className="bg-white p-12 rounded-2xl border border-slate-100 text-center text-slate-400 max-w-md mx-auto">
                        <Search className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                        <p className="font-semibold text-slate-600 mb-1">Nenhum pedido encontrado</p>
                        <p className="text-sm">Não há pedidos {adminOrderSubTab === 'pending' ? 'pendentes' : adminOrderSubTab === 'assembled' ? 'montados' : 'entregues'} correspondentes a essa busca.</p>
                      </div>
                    );
                  }

                  const ordersByGroup = filteredOrders.reduce((acc, order) => {
                    const groupName = order.customers?.group_name || 'Sem Grupo';
                    if (!acc[groupName]) {
                      acc[groupName] = [];
                    }
                    acc[groupName].push(order);
                    return acc;
                  }, {});

                  const sortedGroups = Object.keys(ordersByGroup).sort((a, b) => {
                    if (a === 'Sem Grupo') return 1;
                    if (b === 'Sem Grupo') return -1;
                    return a.localeCompare(b, 'pt-BR');
                  });

                  return (
                    <div className="space-y-8">
                      {sortedGroups.map((groupName) => {
                        const groupOrders = ordersByGroup[groupName];
                        return (
                          <div key={groupName} className="space-y-4">
                            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                              <h3 className="font-bold text-slate-800 text-sm font-mono uppercase tracking-wider">
                                {groupName} <span className="text-slate-400 text-xs font-normal font-sans">({groupOrders.length} {groupOrders.length === 1 ? 'pedido' : 'pedidos'})</span>
                              </h3>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {groupOrders.map((order) => {
                        const hasAppx = order.order_items.some(item => item.is_approximate)
                        const isPending = order.status === 'pending'
                        const dateFormatted = new Date(order.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

                        return (
                          <div key={order.id} className={`bg-white rounded-2xl border ${isPending ? 'border-indigo-100' : 'border-slate-100'} p-5 shadow-sm space-y-4 flex flex-col justify-between`}>
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-xxs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-semibold">
                                  #{order.id.substring(0, 8).toUpperCase()}
                                </span>
                                <div className="flex items-center gap-2">
                                  {order.is_assembled && (
                                    <span className="bg-amber-100 text-amber-800 border border-amber-200 text-xxs font-bold px-2 py-0.5 rounded-lg font-mono">
                                      Montado
                                    </span>
                                  )}
                                  <span className="text-xxs text-slate-400">{dateFormatted}</span>
                                  <span className={`text-xxs font-semibold px-2 py-0.5 rounded-full ${order.status === 'delivered' ? 'bg-emerald-50 text-emerald-600' : order.status === 'cancelled' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                                    {order.status === 'delivered' ? 'Entregue' : order.status === 'cancelled' ? 'Cancelado' : 'Pendente'}
                                  </span>
                                  <span className={`text-xxs font-bold px-2 py-0.5 rounded-lg border ${order.payment_status === 'paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                                    {order.payment_status === 'paid' ? 'Pago' : 'Pagamento Pendente'}
                                  </span>
                                </div>
                              </div>

                              <div className="border-t border-slate-50 pt-2 space-y-1">
                                {order.customers?.nickname ? (
                                  <>
                                    <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                                      <User className="w-4 h-4 text-slate-400" />
                                      {order.customers.nickname}
                                    </p>
                                    <p className="text-xxs text-slate-400 font-normal pl-5.5">
                                      Nome: {order.customers.name}
                                    </p>
                                  </>
                                ) : (
                                  <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                                    <User className="w-4 h-4 text-slate-400" />
                                    {order.customers?.name}
                                  </p>
                                )}
                                <p className="text-xs text-slate-500 flex items-center gap-1.5 font-mono">
                                  <Phone className="w-4 h-4 text-slate-400" />
                                  {getFormattedPhone(order.customers?.phone)}
                                </p>
                                <p className="text-xs text-slate-500 flex items-start gap-1.5 leading-tight">
                                  <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                                  <span>{order.delivery_address}</span>
                                </p>
                                {order.notes && (
                                  <p className="text-xxs bg-amber-50 text-amber-800 p-2 rounded-lg border border-amber-100/50 mt-1 font-mono">
                                    <strong>Obs:</strong> {order.notes}
                                  </p>
                                )}
                              </div>

                              <div className="bg-slate-50 p-3.5 rounded-xl space-y-2">
                                <span className="block text-xxs font-semibold text-slate-400 uppercase tracking-wider font-mono">Itens do Pedido</span>
                                <div className="divide-y divide-slate-100">
                                  {order.order_items.map(item => {
                                    const finalQty = item.quantity_final
                                    const reqQty = item.quantity_requested
                                    const unit = item.products?.unit || 'un'
                                    const isItemAppx = item.is_approximate

                                    return (
                                      <div key={item.id} className="py-1.5 flex items-center justify-between text-xs text-slate-700">
                                        <div className="flex items-center gap-1.5">
                                          <span>{formatQuantity(isItemAppx && finalQty === null ? reqQty : finalQty !== null ? finalQty : reqQty, unit)} x {item.products?.name || 'Item Excluído'}</span>
                                          {isItemAppx && (
                                            <span className="text-xxs bg-indigo-50 text-indigo-600 px-1 rounded flex items-center gap-0.5 shrink-0 font-mono">
                                              <Info className="w-2.5 h-2.5" /> Fracionado
                                            </span>
                                          )}
                                        </div>
                                        <span className="font-semibold text-slate-800">
                                          R$ {item.price_final !== null ? item.price_final.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (item.price_unit * reqQty).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>

                              {/* Customer Rating (if exists) */}
                              {order.rating !== null && order.rating !== undefined && (
                                <div className="bg-amber-50/50 border border-amber-100 p-3.5 rounded-xl space-y-1.5 mt-2">
                                  <span className="text-xxs font-bold text-amber-800 uppercase tracking-wider font-mono flex items-center gap-1">
                                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> Avaliação do Cliente
                                  </span>
                                  <div className="flex items-center gap-0.5">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                      <Star 
                                        key={star} 
                                        className={`w-3.5 h-3.5 ${star <= order.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} 
                                      />
                                    ))}
                                    <span className="text-xs font-semibold text-slate-700 ml-1.5 font-mono">{order.rating}/5</span>
                                  </div>
                                  {order.rating_comment && (
                                    <p className="text-xs text-slate-600 italic">"{order.rating_comment}"</p>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="border-t border-slate-100 pt-4 flex items-center justify-between flex-wrap gap-3">
                              <div>
                                <span className="text-xxs text-slate-400 block font-semibold">Valor do Pedido</span>
                                <div className="flex items-baseline gap-1.5 flex-wrap">
                                  <span className="text-base font-bold text-slate-800">
                                    R$ {order.total_price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                  {order.discount > 0 && (
                                    <span className="text-xxs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded flex items-center gap-0.5" title={order.coupon_code ? `Cupom: ${order.coupon_code}` : 'Desconto Manual'}>
                                      {order.coupon_code ? <Tag className="w-2.5 h-2.5" /> : null}
                                      -{order.coupon_code ? `${order.coupon_code} ` : ''}R$ {order.discount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex gap-2 items-center flex-wrap">
                                <button
                                  onClick={() => deleteOrder(order.id)}
                                  className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition"
                                  title="Excluir Pedido"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                                {isPending ? (
                                  <>
                                    <button
                                      onClick={() => toggleAssembly(order)}
                                      className={`py-2 px-3 text-xs font-semibold rounded-lg transition flex items-center gap-1 border ${
                                        order.is_assembled 
                                          ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100' 
                                          : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                                      }`}
                                      title={order.is_assembled ? 'Pedido Montado (clique para desmarcar)' : 'Marcar como Montado'}
                                    >
                                      {order.is_assembled ? (
                                        <>
                                          <CheckSquare className="w-4 h-4 text-amber-600" />
                                          <span>Montado</span>
                                        </>
                                      ) : (
                                        <>
                                          <Square className="w-4 h-4 text-slate-400" />
                                          <span>Montar</span>
                                        </>
                                      )}
                                    </button>
                                    {hasAppx && (
                                      <button
                                        onClick={() => startAdjustingOrder(order)}
                                        className="py-2 px-3 border border-indigo-600 hover:bg-indigo-50 text-indigo-600 text-xs font-semibold rounded-lg transition"
                                      >
                                        Ajustar Fracionados
                                      </button>
                                    )}
                                    <button
                                      onClick={() => startDiscountingOrder(order)}
                                      className="py-2 px-3 border border-emerald-600 hover:bg-emerald-50 text-emerald-600 text-xs font-semibold rounded-lg transition flex items-center gap-1"
                                      title="Aplicar desconto manual ao pedido"
                                    >
                                      <Tag className="w-4 h-4" />
                                      Desconto
                                    </button>
                                    <button
                                      onClick={() => togglePaymentStatus(order.id, order.payment_status)}
                                      className={`py-2 px-3 text-xs font-semibold rounded-lg transition flex items-center gap-1 border ${
                                        order.payment_status === 'paid'
                                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                                          : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
                                      }`}
                                      title={order.payment_status === 'paid' ? 'Pagamento Confirmado (clique para estornar)' : 'Confirmar Pagamento'}
                                    >
                                      {order.payment_status === 'paid' ? (
                                        <>
                                          <CheckSquare className="w-4 h-4 text-emerald-600" />
                                          <span>Pago</span>
                                        </>
                                      ) : (
                                        <>
                                          <Square className="w-4 h-4 text-amber-600" />
                                          <span>Confirmar PGTO</span>
                                        </>
                                      )}
                                    </button>
                                    <button
                                      onClick={() => handleMarkAsDelivered(order)}
                                      className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition flex items-center gap-1 shadow-sm"
                                    >
                                      <Check className="w-4 h-4" />
                                      Entregue
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {order.status === 'delivered' && (
                                      <>
                                        <button
                                          onClick={() => togglePaymentStatus(order.id, order.payment_status)}
                                          className={`py-2 px-3 text-xs font-semibold rounded-lg transition flex items-center gap-1 border ${
                                            order.payment_status === 'paid'
                                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                                              : 'bg-red-50 border-red-200 text-red-800 hover:bg-red-100'
                                          }`}
                                          title={order.payment_status === 'paid' ? 'Pagamento Confirmado (clique para estornar)' : 'Confirmar Pagamento'}
                                        >
                                          {order.payment_status === 'paid' ? (
                                            <>
                                              <CheckSquare className="w-4 h-4 text-emerald-600" />
                                              <span>Pago</span>
                                            </>
                                          ) : (
                                            <>
                                              <Square className="w-4 h-4 text-red-500" />
                                              <span>Confirmar PGTO</span>
                                            </>
                                          )}
                                        </button>
                                        <button
                                          onClick={() => handleRevertToPending(order)}
                                          className="py-2 px-3 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-lg transition flex items-center gap-1"
                                          title="Reverter pedido de volta para Montados"
                                        >
                                          <Undo2 className="w-4 h-4 text-slate-500" />
                                          <span>Reverter</span>
                                        </button>
                                      </>
                                    )}
                                    <button
                                      onClick={() => handleSendWhatsAppOnly(order)}
                                      className="py-2 px-3 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-lg transition flex items-center gap-1.5"
                                      title="Enviar ou reenviar WhatsApp"
                                    >
                                      <ExternalLink className="w-4 h-4" />
                                      WhatsApp
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  );
                })()
              )}
            </div>
          )
        })()}

          {/* TAB 2: PRODUCTS */}
          {adminTab === 'products' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">Todos os Produtos</h2>
                <div className="flex gap-2">
                  {adminProducts.length === 0 && (
                    <button
                      onClick={handleSeedDatabase}
                      className="py-2.5 px-4 border border-indigo-600 text-indigo-600 hover:bg-indigo-50 text-xs font-semibold rounded-xl transition flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Semear Demonstrativo
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditingProduct(null)
                      setProductForm({ name: '', description: '', price: '', unit: 'unidade', is_approximate: false, image_url: '', is_active: true })
                      setShowProductModal(true)
                    }}
                    className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-sm shadow-indigo-100"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Novo Produto
                  </button>
                </div>
              </div>

              {adminProducts.length === 0 ? (
                <div className="bg-white p-12 rounded-2xl border border-slate-100 text-center text-slate-400 max-w-md mx-auto">
                  <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                  <p className="font-semibold text-slate-600 mb-1">Nenhum produto cadastrado</p>
                  <p className="text-sm">Clique em "Novo Produto" ou "Semear Demonstrativo" para começar.</p>
                </div>
              ) : (
                <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold font-mono text-xxs uppercase tracking-wider">
                          <th className="py-3 px-4">Imagem</th>
                          <th className="py-3 px-4">Nome / Descrição</th>
                          <th className="py-3 px-4">Preço / Unidade</th>
                          <th className="py-3 px-4">Modo Peso</th>
                          <th className="py-3 px-4">Estoque</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {adminProducts.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50/50">
                            <td className="py-3.5 px-4">
                              <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200/50 overflow-hidden flex items-center justify-center">
                                {p.image_url ? (
                                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                                ) : (
                                  <Package className="w-5 h-5 text-slate-300" />
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="font-bold text-slate-700 block">{p.name}</span>
                              <span className="text-xxs text-slate-400 line-clamp-1">{p.description || 'Sem descrição.'}</span>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="font-semibold text-slate-800">R$ {p.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              <span className="text-xxs text-slate-400 block font-mono">por {p.unit}</span>
                            </td>
                            <td className="py-3.5 px-4">
                              {p.is_approximate ? (
                                <span className="bg-indigo-50 text-indigo-700 text-xxs font-semibold px-2 py-0.5 rounded-lg border border-indigo-100 font-mono">
                                  Fracionado
                                </span>
                              ) : (
                                <span className="bg-slate-50 text-slate-500 text-xxs font-semibold px-2 py-0.5 rounded-lg border border-slate-200 font-mono">
                                  Fixo
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-xs">
                              {p.stock === null || p.stock === undefined ? (
                                <span className="text-slate-400 font-semibold italic">Ilimitado</span>
                              ) : p.stock <= 0 ? (
                                <span className="text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-200">Sem estoque</span>
                              ) : (
                                <span className="text-slate-700 font-semibold">{p.stock} {p.unit}(s)</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${p.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} title={p.is_active ? 'Ativo' : 'Inativo'}></span>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => startEditProduct(p)}
                                  className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-indigo-600 rounded transition"
                                  title="Editar"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => deleteProduct(p.id)}
                                  className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded transition"
                                  title="Excluir"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CUSTOMERS */}
          {adminTab === 'customers' && (() => {
            const uniqueGroups = Array.from(new Set(adminCustomers.map(c => c.group_name).filter(Boolean)))
            const filteredCustomers = adminCustomers.filter(c => {
              if (customerGroupFilter === 'all') return true
              if (customerGroupFilter === 'none') return !c.group_name
              return c.group_name && c.group_name.trim().toLowerCase() === customerGroupFilter.trim().toLowerCase()
            })

            return (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">Clientes Cadastrados</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Gerencie os clientes e organize-os por grupos internos.</p>
                  </div>
                  <div className="flex gap-2 self-start sm:self-auto flex-wrap">
                    <button
                      onClick={() => {
                        setNewGroupName('')
                        setSelectedGroupCustomers([])
                        setGroupSearchQuery('')
                        setShowCreateGroupModal(true)
                      }}
                      className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-sm shadow-emerald-100"
                    >
                      <Users className="w-4 h-4" />
                      Criar Grupo
                    </button>
                    <button
                      onClick={() => {
                        setCustomerForm({ name: '', phone: '', nickname: '', group_name: '' })
                        setShowCustomerModal(true)
                      }}
                      className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-sm shadow-indigo-100"
                    >
                      <PlusCircle className="w-4 h-4" />
                      Novo Cliente
                    </button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center bg-slate-50 p-4 rounded-xl border border-slate-100/80">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-500 font-mono uppercase">Filtrar por Grupo:</span>
                    <select
                      value={customerGroupFilter}
                      onChange={(e) => setCustomerGroupFilter(e.target.value)}
                      className="text-xs font-semibold bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="all">Todos os Grupos</option>
                      <option value="none">Sem Grupo</option>
                      {uniqueGroups.map((g, idx) => (
                        <option key={idx} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                  <div className="text-xxs text-slate-400 font-mono font-semibold">
                    Mostrando {filteredCustomers.length} de {adminCustomers.length} clientes
                  </div>
                </div>

                {filteredCustomers.length === 0 ? (
                  <div className="bg-white p-12 rounded-2xl border border-slate-100 text-center text-slate-400 max-w-md mx-auto">
                    <User className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-semibold text-slate-600 mb-1">Nenhum cliente nesta seleção</p>
                    <p className="text-sm">Cadastre clientes ou mude o filtro para visualizar.</p>
                  </div>
                ) : (
                  <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold font-mono text-xxs uppercase tracking-wider">
                            <th className="py-3 px-4">Nome</th>
                            <th className="py-3 px-4">Telefone</th>
                            <th className="py-3 px-4">Endereço Cadastrado</th>
                            <th className="py-3 px-4 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {filteredCustomers.map((c) => {
                            const hasAddress = c.street && c.number && c.neighborhood && c.city
                            const formattedAddress = hasAddress 
                              ? `${c.street}, Nº ${c.number}${c.complement ? ` - ${c.complement}` : ''}, ${c.neighborhood}, ${c.city}-${c.state} (CEP: ${getFormattedCep(c.cep || '')})`
                              : 'Endereço não cadastrado'

                            return (
                              <tr key={c.id} className="hover:bg-slate-50/50">
                                <td className="py-3.5 px-4 font-bold text-slate-700 flex items-center gap-1.5">
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {c.nickname ? (
                                        <>
                                          <span className="text-slate-800 font-bold">{c.nickname}</span>
                                          <span className="text-xxs text-slate-400 font-normal">
                                            ({c.name})
                                          </span>
                                        </>
                                      ) : (
                                        <span className="text-slate-800 font-bold">{c.name}</span>
                                      )}
                                      {c.group_name && (
                                        <span className="text-xxs font-mono font-bold text-indigo-600 bg-indigo-50 border border-indigo-100/50 px-1.5 py-0.5 rounded shadow-xxs">
                                          {c.group_name}
                                        </span>
                                      )}
                                    </div>
                                    {c.profile_updated_pending && (
                                      <span 
                                        onMouseEnter={() => handleClearCustomerNotification(c.id)}
                                        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-600 border border-amber-300 font-bold text-xs animate-bounce cursor-help mt-1 w-fit"
                                        title="Cadastro atualizado pelo cliente! Passe o mouse para limpar."
                                      >
                                        !
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3.5 px-4 font-mono text-slate-600">{getFormattedPhone(c.phone)}</td>
                                <td className={`py-3.5 px-4 text-xs ${hasAddress ? 'text-slate-600' : 'text-slate-400'}`}>
                                  {formattedAddress}
                                </td>
                                <td className="py-3.5 px-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => startEditNickname(c)}
                                      className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-indigo-600 rounded transition"
                                      title="Definir Apelido"
                                    >
                                      <Tag className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => startEditCustomer(c)}
                                      className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-indigo-600 rounded transition"
                                      title="Editar Cadastro"
                                    >
                                      <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => deleteCustomer(c.id)}
                                      className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded transition"
                                      title="Excluir Cliente"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => handleImpersonate(c)}
                                      className="py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-semibold rounded-lg transition inline-flex items-center gap-1.5"
                                      title="Fazer pedido em nome deste cliente"
                                    >
                                      <ShoppingBag className="w-3.5 h-3.5" />
                                      Fazer Pedido
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* TAB: ABANDONED CARTS */}
          {adminTab === 'abandoned_carts' && (() => {
            const allCartsWithItems = adminCustomers.filter(c => {
              return c.active_cart && Array.isArray(c.active_cart) && c.active_cart.length > 0 && c.cart_updated_at;
            });

            const filteredAbandoned = allCartsWithItems.filter(c => {
              const diffMs = Date.now() - new Date(c.cart_updated_at).getTime();
              const is15Min = diffMs >= 15 * 60 * 1000;
              
              if (abandonedCartFilter === '15min' && !is15Min) return false;

              if (abandonedCartSearch.trim()) {
                const query = abandonedCartSearch.toLowerCase();
                const matchName = c.name && c.name.toLowerCase().includes(query);
                const matchNick = c.nickname && c.nickname.toLowerCase().includes(query);
                const matchPhone = c.phone && c.phone.includes(query);
                return matchName || matchNick || matchPhone;
              }

              return true;
            }).sort((a, b) => new Date(b.cart_updated_at).getTime() - new Date(a.cart_updated_at).getTime());

            return (
              <div className="space-y-6 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                      <ShoppingCart className="w-5 h-5 text-indigo-600" />
                      Carrinhos Não Finalizados
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Acompanhe os clientes com produtos no carrinho e contate-os para auxiliá-los a fechar o pedido.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={loadAdminCustomers}
                      className="py-2 px-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-2xs"
                      title="Recarregar dados"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Atualizar</span>
                    </button>
                  </div>
                </div>

                {/* Filters & Search Row */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-2xs">
                  {/* Filter Pills */}
                  <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl w-full sm:w-auto">
                    <button
                      onClick={() => setAbandonedCartFilter('15min')}
                      className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                        abandonedCartFilter === '15min' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <span>Abandonados (+15 min)</span>
                      <span className={`text-xxs px-1.5 py-0.5 rounded-md font-mono font-bold ${
                        abandonedCartFilter === '15min' ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {allCartsWithItems.filter(c => (Date.now() - new Date(c.cart_updated_at).getTime()) >= 15 * 60 * 1000).length}
                      </span>
                    </button>
                    <button
                      onClick={() => setAbandonedCartFilter('all')}
                      className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                        abandonedCartFilter === 'all' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <span>Todos Ativos</span>
                      <span className={`text-xxs px-1.5 py-0.5 rounded-md font-mono font-bold ${
                        abandonedCartFilter === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {allCartsWithItems.length}
                      </span>
                    </button>
                  </div>

                  {/* Search Input */}
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar por cliente ou telefone..."
                      value={abandonedCartSearch}
                      onChange={(e) => setAbandonedCartSearch(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-white transition"
                    />
                    {abandonedCartSearch && (
                      <button
                        onClick={() => setAbandonedCartSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Carts Grid / List */}
                {filteredAbandoned.length === 0 ? (
                  <div className="bg-white p-12 rounded-2xl text-center text-slate-400 border border-slate-100 shadow-2xs">
                    <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-bold text-slate-700 mb-1">Nenhum carrinho encontrado</p>
                    <p className="text-xs text-slate-400">
                      {abandonedCartFilter === '15min' 
                        ? 'Não há clientes com compras paradas há mais de 15 minutos.' 
                        : 'No momento nenhum cliente possui itens pendentes no carrinho.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {filteredAbandoned.map(customer => {
                      const diffMinutes = Math.floor((Date.now() - new Date(customer.cart_updated_at).getTime()) / 60000);
                      const isOver15 = diffMinutes >= 15;
                      const cartTotal = customer.active_cart.reduce((t, i) => t + (i.price * i.quantity), 0);
                      const totalItemsCount = customer.active_cart.reduce((t, i) => t + (i.unit === 'kg' ? 1 : i.quantity), 0);

                      let timeText = `há ${diffMinutes} min`;
                      if (diffMinutes >= 60) {
                        const hours = Math.floor(diffMinutes / 60);
                        const mins = diffMinutes % 60;
                        timeText = `há ${hours}h ${mins > 0 ? `${mins}m` : ''}`;
                      }

                      return (
                        <div 
                          key={customer.id} 
                          className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-2xs hover:shadow-md transition-all space-y-4 flex flex-col justify-between"
                        >
                          <div className="space-y-3">
                            {/* Header: Customer Info & Elapsed Time */}
                            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                              <div>
                                <div className="flex items-center gap-2">
                                  <h3 className="font-bold text-slate-900 text-base">
                                    {customer.nickname || customer.name}
                                  </h3>
                                  {customer.nickname && (
                                    <span className="text-xxs text-slate-400 font-mono">({customer.name})</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5 font-mono">
                                  <span className="flex items-center gap-1">
                                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                                    {getFormattedPhone(customer.phone)}
                                  </span>
                                  {customer.neighborhood && (
                                    <span className="flex items-center gap-1 text-slate-400 font-sans">
                                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                                      {customer.neighborhood}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <span className={`text-xxs font-bold px-2.5 py-1 rounded-lg shrink-0 flex items-center gap-1 font-mono ${
                                isOver15 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-600'
                              }`}>
                                <Calendar className="w-3 h-3" />
                                {timeText}
                              </span>
                            </div>

                            {/* Cart Items List */}
                            <div className="bg-slate-50/80 rounded-xl p-3 space-y-2 border border-slate-100">
                              <div className="flex items-center justify-between text-xxs font-bold text-slate-400 uppercase tracking-wider font-mono">
                                <span>Itens no Carrinho ({totalItemsCount})</span>
                                <span>Subtotal</span>
                              </div>
                              <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto pr-1">
                                {customer.active_cart.map((item, idx) => (
                                  <div key={idx} className="py-2 flex items-center justify-between text-xs gap-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/80 p-0.5 flex items-center justify-center shrink-0 overflow-hidden">
                                        {item.image_url ? (
                                          <img src={item.image_url} alt={item.name} className="w-full h-full object-contain" />
                                        ) : (
                                          <Package className="w-4 h-4 text-slate-300" />
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="font-semibold text-slate-800 truncate leading-tight">{item.name}</p>
                                        <p className="text-xxs text-slate-400 font-mono">
                                          {item.quantity} {item.unit || 'un'} x R$ {item.price.toFixed(2)}
                                        </p>
                                      </div>
                                    </div>
                                    <span className="font-bold text-slate-900 shrink-0 font-mono">
                                      R$ {(item.price * item.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Footer: Total & Actions */}
                          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <span className="text-xxs text-slate-400 font-semibold block uppercase font-mono">Total no Carrinho</span>
                              <span className="text-lg font-black text-slate-900 font-mono">
                                R$ {cartTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleImpersonate(customer)}
                                className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition flex items-center gap-1.5"
                                title="Fazer pedido pelo cliente"
                              >
                                <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                                <span>Ver Catálogo</span>
                              </button>
                              
                              <button
                                onClick={() => handleContactAbandonedCartCustomer(customer)}
                                className="py-2 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-sm active:scale-95"
                                title="Enviar mensagem personalizada no WhatsApp"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span>WhatsApp</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* TAB 3.5: COUPONS (ADMIN) */}
          {adminTab === 'coupons' && (
            <div className="space-y-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Cupons de Desconto</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Crie e gerencie cupons promocionais para seus clientes.</p>
                </div>
                <button
                  onClick={() => {
                    setEditingCouponState(null)
                    setCouponForm({
                      code: '',
                      discount_type: 'percentage',
                      discount_value: '',
                      max_uses: '',
                      max_uses_per_client: '1',
                      expires_at: '',
                      is_active: true
                    })
                    setShowCouponModal(true)
                  }}
                  className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-sm shadow-indigo-100 self-start sm:self-auto"
                >
                  <PlusCircle className="w-4 h-4" />
                  Novo Cupom
                </button>
              </div>

              {adminCoupons.length === 0 ? (
                <div className="bg-white p-12 rounded-2xl border border-slate-100 text-center text-slate-400 max-w-md mx-auto">
                  <Tag className="w-12 h-12 mx-auto mb-3 text-slate-300 animate-pulse" />
                  <p className="font-semibold text-slate-600 mb-1">Nenhum cupom cadastrado</p>
                  <p className="text-sm">Cadastre cupons para que os clientes possam usá-los no checkout.</p>
                </div>
              ) : (
                <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold font-mono text-xxs uppercase tracking-wider">
                          <th className="py-3 px-4">Código</th>
                          <th className="py-3 px-4">Desconto</th>
                          <th className="py-3 px-4">Limite de Usos</th>
                          <th className="py-3 px-4">Limite/Cliente</th>
                          <th className="py-3 px-4">Expiração</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {adminCoupons.map((c) => {
                          const isExpired = c.expires_at && new Date(c.expires_at) < new Date()
                          return (
                            <tr key={c.id} className="hover:bg-slate-50/50">
                              <td className="py-3.5 px-4 font-mono font-bold text-slate-800 uppercase tracking-wide">
                                {c.code}
                              </td>
                              <td className="py-3.5 px-4 font-semibold text-slate-700">
                                {c.discount_type === 'percentage' ? `${c.discount_value}%` : `R$ ${parseFloat(c.discount_value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              </td>
                              <td className="py-3.5 px-4 text-slate-600 font-mono text-xs">
                                {c.max_uses === null ? 'Sem limite' : c.max_uses}
                              </td>
                              <td className="py-3.5 px-4 text-slate-600 font-mono text-xs">
                                {c.max_uses_per_client === null ? 'Sem limite' : `${c.max_uses_per_client} vez(es)`}
                              </td>
                              <td className="py-3.5 px-4 text-slate-500 text-xs">
                                {c.expires_at ? new Date(c.expires_at).toLocaleDateString('pt-BR') : 'Nunca expira'}
                              </td>
                              <td className="py-3.5 px-4">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xxs font-bold ${c.is_active && !isExpired ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-650 border border-red-100'}`}>
                                  {isExpired ? 'Expirado' : c.is_active ? 'Ativo' : 'Inativo'}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => startEditCoupon(c)}
                                    className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-indigo-600 rounded transition"
                                    title="Editar Cupom"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => deleteCoupon(c.id)}
                                    className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded transition"
                                    title="Excluir Cupom"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SETTINGS */}
          {adminTab === 'settings' && (
            <form onSubmit={handleSaveSettings} className="space-y-6 max-w-6xl w-full animate-fade-in">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                
                {/* COL 1: Configurations */}
                <div className="space-y-6">
                  {/* Card 1: Templates de Mensagens */}
                  <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 mb-1">Templates de Mensagens do WhatsApp</h2>
                      <p className="text-slate-400 text-xs leading-relaxed">
                        Estas são as mensagens que o aplicativo carrega automaticamente ao interagir com o cliente.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 font-mono">Mensagem de Entrega</label>
                        <textarea
                          value={whatsappTemplate}
                          onChange={(e) => setWhatsappTemplate(e.target.value)}
                          rows="4"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-sm font-mono"
                          required
                        ></textarea>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 font-mono">Mensagem de Entrega Sem Cobrança (Já pago / Dinheiro / Sem Pix)</label>
                        <textarea
                          value={whatsappTemplateNoCharge}
                          onChange={(e) => setWhatsappTemplateNoCharge(e.target.value)}
                          rows="4"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-sm font-mono"
                          required
                        ></textarea>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 font-mono">Mensagem do Pix</label>
                        <textarea
                          value={pixMessageTemplate}
                          onChange={(e) => setPixMessageTemplate(e.target.value)}
                          rows="4"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-sm font-mono"
                          required
                        ></textarea>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 font-mono">Mensagem de Carrinho Não Finalizado (Aba Carrinhos)</label>
                        <textarea
                          value={whatsappAbandonedCartTemplate}
                          onChange={(e) => setWhatsappAbandonedCartTemplate(e.target.value)}
                          rows="4"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-sm font-mono"
                          required
                        ></textarea>
                      </div>

                      {/* Variables info block */}
                      <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl space-y-2">
                        <span className="block text-xxs font-bold text-indigo-700 uppercase tracking-wider font-mono">Variáveis Dinâmicas Disponíveis:</span>
                        <div className="grid grid-cols-2 gap-2 text-xxs text-indigo-950 font-mono">
                          <p><code>{`{nome}`}</code> : Nome do cliente</p>
                          <p><code>{`{pedido_id}`}</code> : Código do pedido</p>
                          <p><code>{`{total}`}</code> : Preço total do pedido</p>
                          <p><code>{`{endereco}`}</code> : Endereço completo</p>
                          <p><code>{`{pix}`}</code> : Chave/QR code do Pix</p>
                          <p><code>{`{link_pagamento}`}</code> : Link do rastreio/Pix (apenas na msg do Pix)</p>
                          <p className="col-span-2"><code>{`{itens}`}</code> : Lista dos produtos no formato: <br />- Item: Qtd (Preço)</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Success Screen Informativo Settings */}
                  <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 mb-1">Informativo "O que acontece agora?"</h2>
                      <p className="text-slate-400 text-xs leading-relaxed">
                        Personalize o texto informativo exibido na tela de sucesso logo após o cliente enviar o pedido.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 font-mono">Texto do Sucesso do Pedido</label>
                      <textarea
                        value={whatHappensNowText}
                        onChange={(e) => setWhatHappensNowText(e.target.value)}
                        rows="6"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-sm font-mono"
                        required
                      ></textarea>
                    </div>
                  </div>

                  {/* Card 3: Gateway SMS & WhatsApp */}
                  <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 mb-1">Gateway de SMS & WhatsApp Automático</h2>
                      <p className="text-slate-400 text-xs leading-relaxed">
                        Configurações para envio automático em segundo plano sem intervenção do cliente.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 font-mono">Chave de API Textbelt (SMS)</label>
                        <input
                          type="text"
                          value={smsApiKey}
                          onChange={(e) => setSmsApiKey(e.target.value)}
                          placeholder="textbelt (Gratuito padrão)"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-sm font-mono"
                        />
                        <p className="text-xxs text-slate-400 mt-1">Padrão gratuito: <code>textbelt</code> (1 SMS grátis/dia por IP) ou insira sua chave própria.</p>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 font-mono">URL da API / Webhook de WhatsApp (Opcional)</label>
                        <input
                          type="text"
                          value={whatsappApiUrl}
                          onChange={(e) => setWhatsappApiUrl(e.target.value)}
                          placeholder="https://sua-api.com/message/send (ou deixe vazio para CallMeBot grátis)"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-sm font-mono"
                        />
                        <p className="text-xxs text-slate-400 mt-1">Compatível com Evolution API, Z-API, Green-API ou webhook customizado.</p>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 font-mono">Token / Chave de Acesso WhatsApp (Opcional)</label>
                        <input
                          type="text"
                          value={whatsappApiToken}
                          onChange={(e) => setWhatsappApiToken(e.target.value)}
                          placeholder="Token da API / Chave CallMeBot"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-sm font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* COL 2: Live Preview & Pix Config */}
                <div className="space-y-6">
                  {/* Card 3: WhatsApp Chat Preview */}
                  <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-4">
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 mb-1">Prévia em Tempo Real (WhatsApp)</h2>
                      <p className="text-slate-400 text-xs leading-relaxed">
                        Veja em tempo real como ficarão as mensagens de WhatsApp enviadas ao cliente.
                      </p>
                    </div>

                    <div className="border border-slate-200 rounded-2xl p-4 bg-[#efeae2] space-y-4 shadow-inner min-h-[300px] flex flex-col justify-end">
                      {/* Delivery message preview bubble */}
                      <div className="flex flex-col space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wide">Mensagem de Entrega</span>
                        <div className="bg-[#d9fdd3] text-[#111b21] p-3 rounded-2xl rounded-tl-none text-xs font-mono whitespace-pre-wrap max-w-[90%] border border-[#b2ebb4] shadow-xs relative leading-relaxed">
                          {whatsappTemplate
                            .replace(/{nome}/g, 'Maria Silva')
                            .replace(/{pedido_id}/g, '12345678')
                            .replace(/R\$\s*{total}/g, `*R$ 45,90*`)
                            .replace(/{total}/g, `*R$ 45,90*`)
                            .replace(/{endereco}/g, 'Rua das Flores, 123 - Centro')
                            .replace(/{pix}/g, pixEnabled && pixKey ? `Chave Pix: ${pixKey}` : '')
                            .replace(/{itens}/g, '- 1x Pizza Calabreza (R$ 45,90)')
                          }
                        </div>
                      </div>

                      {/* Pix message preview bubble */}
                      <div className="flex flex-col space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 font-mono uppercase tracking-wide">Mensagem do Pix</span>
                        <div className="bg-[#d9fdd3] text-[#111b21] p-3 rounded-2xl rounded-tl-none text-xs font-mono whitespace-pre-wrap max-w-[90%] border border-[#b2ebb4] shadow-xs relative leading-relaxed">
                          {pixMessageTemplate
                            .replace(/{pedido_id}/g, '12345678')
                            .replace(/R\$\s*{total}/g, `*R$ 45,90*`)
                            .replace(/{total}/g, `*R$ 45,90*`)
                            .replace(/{link_pagamento}/g, `${window.location.origin}?pedido=12345678`)
                            .replace(/{chave_pix}/g, pixKey || '[Sua Chave Pix]')
                            .replace(/{copia_cola}/g, '[Código Pix Copia e Cola]')
                          }
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card 4: Pix Settings */}
                  <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-bold text-slate-800 mb-1">Configuração do Pix</h2>
                        <p className="text-slate-400 text-xs leading-relaxed">
                          Cadastre suas informações do Pix. Os clientes receberão o Pix Copia e Cola / QR Code para realizar o pagamento.
                        </p>
                      </div>
                      {/* Toggle switch */}
                      <button
                        type="button"
                        onClick={() => setPixEnabled(!pixEnabled)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${pixEnabled ? 'bg-indigo-600' : 'bg-slate-200'}`}
                      >
                        <span className="sr-only">Habilitar Pix</span>
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${pixEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>

                    {!pixEnabled ? (
                      <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl text-center text-slate-500 text-xs leading-relaxed">
                        O pagamento via Pix está atualmente <strong>desativado</strong> para os clientes. 
                        Nenhuma chave Pix ou QR Code será enviada nas mensagens de WhatsApp ou mostrada na página de acompanhamento de pedidos.
                      </div>
                    ) : (
                      <div className="space-y-4 text-sm">
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Tipo de Pix</label>
                          <select
                            value={pixType}
                            onChange={(e) => setPixType(e.target.value)}
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none"
                          >
                            <option value="dynamic">Pix Dinâmico (Gera Copia e Cola + QR Code com o valor exato do pedido)</option>
                            <option value="static">Pix Estático (Chave Pix ou imagem do QR Code fixa)</option>
                          </select>
                        </div>

                        {pixType === 'dynamic' ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Chave Pix</label>
                              <input
                                type="text"
                                placeholder="Ex: CPF, E-mail, Celular ou Chave Aleatória"
                                value={pixKey}
                                onChange={(e) => setPixKey(e.target.value)}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Nome do Recebedor (Beneficiário)</label>
                              <input
                                type="text"
                                placeholder="Ex: Fulano de Tal"
                                value={pixName}
                                onChange={(e) => setPixName(e.target.value)}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Cidade do Recebedor</label>
                              <input
                                type="text"
                                placeholder="Ex: SAO PAULO"
                                value={pixCity}
                                onChange={(e) => setPixCity(e.target.value)}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Chave Pix Estática / Instruções</label>
                              <input
                                type="text"
                                placeholder="Ex: Chave Pix CNPJ: 12.345.678/0001-90"
                                value={pixKey}
                                onChange={(e) => setPixKey(e.target.value)}
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Upload do QR Code Estático (Imagem)</label>
                              <div className="flex items-center gap-4 bg-slate-50 border border-slate-100 p-4 rounded-xl">
                                <div 
                                  onClick={() => pixFileInputRef.current?.click()}
                                  className="w-24 h-24 bg-white border border-slate-200 rounded-xl overflow-hidden shrink-0 flex flex-col items-center justify-center text-slate-400 relative cursor-pointer group transition"
                                >
                                  {pixQrCodeStatic ? (
                                    <img src={pixQrCodeStatic} alt="QR Code Pix" className="w-full h-full object-cover" />
                                  ) : (
                                    <Plus className="w-5 h-5 text-slate-400" />
                                  )}
                                </div>
                                <div className="flex-1">
                                  <input
                                    type="file"
                                    ref={pixFileInputRef}
                                    accept="image/*"
                                    onChange={(e) => {
                                      const file = e.target.files[0]
                                      if (!file) return
                                      const reader = new FileReader()
                                      reader.onload = (event) => {
                                        setPixQrCodeStatic(event.target.result)
                                      }
                                      reader.readAsDataURL(file)
                                    }}
                                    className="hidden"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => pixFileInputRef.current?.click()}
                                    className="py-1.5 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition shadow-xs"
                                  >
                                    Carregar QR Code...
                                  </button>
                                  {pixQrCodeStatic && (
                                    <button
                                      type="button"
                                      onClick={() => setPixQrCodeStatic('')}
                                      className="ml-2 text-red-500 text-xs hover:underline"
                                    >
                                      Remover
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

              </div>
              
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="py-3 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition shadow-md shadow-indigo-100 flex items-center justify-center gap-2"
                >
                  Salvar Todas as Configurações
                </button>
              </div>
            </form>
          )}

          {/* TAB: CUSTOMIZE PAGE (EDITAR PÁGINA) */}
          {adminTab === 'customize' && (
            <form onSubmit={handleSaveCustomization} className="space-y-6 max-w-2xl animate-fade-in">
              <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 mb-1">Customizar Página do Cliente</h2>
                  <p className="text-slate-400 text-xs leading-relaxed">
                    Personalize o nome, slogan, imagens e paleta de cores que seus clientes verão ao acessar seu estabelecimento.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 font-mono">Nome da Marca</label>
                    <input
                      type="text"
                      value={clientBrandName}
                      onChange={(e) => setClientBrandName(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-sm font-medium"
                      placeholder="Ex: ClickEntregas"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 font-mono">Slogan / Frase de Boas-vindas</label>
                    <input
                      type="text"
                      value={clientBrandSlogan}
                      onChange={(e) => setClientBrandSlogan(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-sm font-medium"
                      placeholder="Ex: Seu pedido entregue com rapidez e segurança"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 font-mono">Paleta de Cores do Cliente</label>
                    <select
                      value={clientColorTheme}
                      onChange={(e) => setClientColorTheme(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-sm font-medium font-mono"
                    >
                      <option value="indigo">Indigo & Slate (Padrão)</option>
                      <option value="emerald">Forest Emerald & Sage (Saudável)</option>
                      <option value="amber">Dark Obsidian & Gold Amber (Premium)</option>
                      <option value="terracotta">Rose Terracotta & Cream (Acolhedor)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5 font-mono">Foto de Logotipo</label>
                      <p className="text-xxs text-slate-400 mb-2 leading-tight">Tamanho ideal: 512x512 pixels (proporção quadrada 1:1, fundo transparente recomendado).</p>
                      <div className="flex items-center gap-3">
                        <input
                          type="file"
                          accept="image/*"
                          ref={logoFileInputRef}
                          onChange={handleLogoUpload}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => logoFileInputRef.current?.click()}
                          className="py-2 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition shadow-xs"
                        >
                          Carregar Logo...
                        </button>
                        {clientBrandLogo && (
                          <button
                            type="button"
                            onClick={() => setClientBrandLogo('')}
                            className="text-red-500 text-xs hover:underline"
                          >
                            Remover
                          </button>
                        )}
                      </div>
                      {clientBrandLogo && (
                        <div className="mt-2 w-16 h-16 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center p-1">
                          <img src={clientBrandLogo} alt="Logo Preview" className="max-w-full max-h-full object-contain" />
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5 font-mono">Foto do Banner Superior</label>
                      <p className="text-xxs text-slate-400 mb-2 leading-tight">Tamanho ideal: 1200x400 pixels (proporção horizontal 3:1).</p>
                      <div className="flex items-center gap-3">
                        <input
                          type="file"
                          accept="image/*"
                          ref={bannerFileInputRef}
                          onChange={handleBannerUpload}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => bannerFileInputRef.current?.click()}
                          className="py-2 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition shadow-xs"
                        >
                          Carregar Banner...
                        </button>
                        {clientBrandBanner && (
                          <button
                            type="button"
                            onClick={() => setClientBrandBanner('')}
                            className="text-red-500 text-xs hover:underline"
                          >
                            Remover
                          </button>
                        )}
                      </div>
                      {clientBrandBanner && (
                        <div className="mt-2 h-16 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 relative">
                          <img src={clientBrandBanner} alt="Banner Preview" className="w-full h-full object-cover" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Preview section inside Admin panel to WOW the owner */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-3">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">Visualização Prévia (Área do Cliente)</h3>
                
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                  {/* Client header banner */}
                  <div 
                    className={`p-6 text-white relative overflow-hidden transition-all duration-300 min-h-32 flex flex-col justify-end ${
                      clientBrandBanner ? '' : getThemeClasses(clientColorTheme).gradientBg
                    }`}
                    style={clientBrandBanner ? { backgroundImage: `linear-gradient(to right, rgba(15, 23, 42, 0.8), rgba(15, 23, 42, 0.4)), url(${clientBrandBanner})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                  >
                    <div className="flex items-center gap-3 relative z-10">
                      {clientBrandLogo ? (
                        <div className="w-12 h-12 rounded-xl bg-white p-1 flex items-center justify-center shadow-md shrink-0">
                          <img src={clientBrandLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
                        </div>
                      ) : (
                        <div className={`p-2.5 rounded-xl bg-white text-slate-800 shadow-md shrink-0`}>
                          <ShoppingBag className="w-6 h-6" />
                        </div>
                      )}
                      <div>
                        <h1 className="text-lg font-extrabold tracking-tight">{clientBrandName}</h1>
                        <p className="text-white/80 text-xxs font-medium mt-0.5">{clientBrandSlogan}</p>
                      </div>
                    </div>
                  </div>
                  {/* Button preview */}
                  <div className="p-4 flex gap-3 justify-end bg-slate-50/50">
                    <span className={`px-2.5 py-1 text-xxs font-bold text-white rounded-full ${getThemeClasses(clientColorTheme).bg}`}>
                      Botão de Exemplo
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="py-3 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition shadow-md shadow-indigo-100 flex items-center justify-center gap-2"
                >
                  Salvar Customizações
                </button>
              </div>
            </form>
          )}

        {/* MODAL: ADD/EDIT PRODUCT */}
        {showProductModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 animate-scale-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 text-lg">
                  {editingProduct ? 'Editar Produto' : 'Novo Produto'}
                </h3>
                <button 
                  onClick={() => setShowProductModal(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Hidden file input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageFileChange}
                accept="image/*"
                className="hidden"
              />

              <form onSubmit={handleSaveProduct} className="space-y-4 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  
                  {/* Image input and preview square */}
                  <div className="sm:col-span-2 bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center gap-4">
                    {/* Visual Square (clickable) */}
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-24 h-24 bg-white border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-xl overflow-hidden shrink-0 flex flex-col items-center justify-center text-slate-400 relative cursor-pointer group transition"
                      title="Clique para selecionar uma foto do seu computador"
                    >
                      {productForm.image_url ? (
                        <img 
                          src={productForm.image_url} 
                          alt="Previa" 
                          className="w-full h-full object-cover group-hover:opacity-75 transition"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div className={`absolute inset-0 flex flex-col items-center justify-center p-2 text-center text-xxs font-semibold bg-white group-hover:bg-slate-50 transition ${productForm.image_url ? 'opacity-0 hover:opacity-100 bg-white/90 text-indigo-600' : 'flex text-slate-400'}`}>
                        <Plus className="w-5 h-5 mb-0.5 text-slate-400 group-hover:text-indigo-500 transition animate-pulse" />
                        <span>{productForm.image_url ? 'Alterar' : 'Enviar Foto'}</span>
                      </div>
                    </div>

                    <div className="flex-1 space-y-2">
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-0.5">Foto do Produto</label>
                      <p className="text-xxs text-slate-400 leading-tight">Tamanho ideal: 400x400 pixels (proporção quadrada 1:1).</p>
                      
                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="py-1.5 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg transition shadow-xs w-full text-left flex items-center gap-2"
                        >
                          <Plus className="w-3.5 h-3.5 text-slate-400" />
                          Escolher arquivo do PC...
                        </button>
                        <span className="block text-xxs text-slate-400 leading-tight">
                          ou cole um link abaixo:
                        </span>
                        <input
                          type="url"
                          placeholder="https://exemplo.com/imagem.jpg"
                          value={productForm.image_url.startsWith('data:') ? '' : productForm.image_url}
                          onChange={(e) => setProductForm({ ...productForm, image_url: e.target.value })}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        />
                      </div>
                      
                      <span className="block text-xxs text-slate-400 leading-tight">
                        💡 <strong>Sugerido:</strong> Imagem quadrada (proporção 1:1), resolução recomendada de <strong>400x400px</strong>. Ao selecionar um arquivo do PC, ele será cortado e otimizado automaticamente.
                      </span>
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Nome do Produto</label>
                    <input
                      type="text"
                      placeholder="Ex: Queijo Mussarela"
                      value={productForm.name}
                      onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      required
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Descrição</label>
                    <textarea
                      placeholder="Descrição opcional do produto..."
                      value={productForm.description}
                      onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                      rows="2"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    ></textarea>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 font-mono">Preço (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Ex: 34.90"
                      value={productForm.price}
                      onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 font-mono">Unidade de Medida</label>
                    <select
                      value={productForm.unit}
                      onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none font-mono"
                    >
                      <option value="unidade">Unidade</option>
                      <option value="kg">Quilo (kg)</option>
                      <option value="g">Grama (g)</option>
                      <option value="pacote">Pacote</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 font-mono">Estoque / Quantidade (kg ou un)</label>
                    <input
                      type="number"
                      step="0.001"
                      placeholder="Ex: 50 (Vazio para ilimitado)"
                      value={productForm.stock === null || productForm.stock === undefined ? '' : productForm.stock}
                      onChange={(e) => {
                        const val = e.target.value;
                        setProductForm({ ...productForm, stock: val === '' ? null : parseFloat(val) });
                      }}
                      onFocus={(e) => e.target.select()}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <span className="text-xxs text-slate-400 mt-1 block">
                      Deixe vazio se o estoque for ilimitado.
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-1">
                    <input
                      type="checkbox"
                      id="is_approximate"
                      checked={productForm.is_approximate}
                      onChange={(e) => setProductForm({ ...productForm, is_approximate: e.target.checked })}
                      className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4 border-slate-300"
                    />
                    <label htmlFor="is_approximate" className="text-xs font-semibold text-slate-600 cursor-pointer">
                      Este produto é fracionado? (vendido por peso)
                    </label>
                  </div>

                  <div className="flex items-center gap-3 mt-1">
                    <input
                      type="checkbox"
                      id="is_active"
                      checked={productForm.is_active}
                      onChange={(e) => setProductForm({ ...productForm, is_active: e.target.checked })}
                      className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <label htmlFor="is_active" className="text-xs font-semibold text-slate-600 cursor-pointer">
                      Produto ativo no catálogo?
                    </label>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowProductModal(false)}
                    className="py-2.5 px-4 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold rounded-xl transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-md shadow-indigo-100"
                  >
                    Salvar Produto
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: ADD/EDIT COUPON (ADMIN) */}
        {showCouponModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 animate-scale-in max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 text-lg">
                  {editingCouponState ? 'Editar Cupom' : 'Cadastrar Novo Cupom'}
                </h3>
                <button 
                  onClick={() => setShowCouponModal(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveCoupon} className="space-y-4 text-xs">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Código do Cupom</label>
                  <input
                    type="text"
                    placeholder="Ex: SEJABEMVINDO"
                    value={couponForm.code}
                    onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-bold uppercase font-mono"
                    required
                    disabled={!!editingCouponState}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Tipo de Desconto</label>
                    <select
                      value={couponForm.discount_type}
                      onChange={(e) => setCouponForm({ ...couponForm, discount_type: e.target.value })}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-semibold"
                    >
                      <option value="percentage">Porcentagem (%)</option>
                      <option value="fixed">Valor Fixo (R$)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Valor do Desconto</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder={couponForm.discount_type === 'percentage' ? 'Ex: 10 para 10%' : 'Ex: 15.00 para R$ 15'}
                      value={couponForm.discount_value}
                      onChange={(e) => setCouponForm({ ...couponForm, discount_value: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono font-semibold"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Limite Global de Usos</label>
                    <input
                      type="number"
                      placeholder="Ex: 100 (Vazio p/ ilimitado)"
                      value={couponForm.max_uses}
                      onChange={(e) => setCouponForm({ ...couponForm, max_uses: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                    />
                    <span className="text-xxs text-slate-400 mt-1 block leading-tight">Total de vezes que este cupom pode ser usado no site.</span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Limite por Cliente</label>
                    <input
                      type="number"
                      placeholder="Ex: 1"
                      value={couponForm.max_uses_per_client}
                      onChange={(e) => setCouponForm({ ...couponForm, max_uses_per_client: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                    />
                    <span className="text-xxs text-slate-400 mt-1 block leading-tight">Quantas vezes um único cliente pode usar este cupom.</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Data de Expiração (Opcional)</label>
                  <input
                    type="date"
                    value={couponForm.expires_at}
                    onChange={(e) => setCouponForm({ ...couponForm, expires_at: e.target.value })}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono font-semibold"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <input
                    type="checkbox"
                    id="coupon_is_active"
                    checked={couponForm.is_active}
                    onChange={(e) => setCouponForm({ ...couponForm, is_active: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                  />
                  <label htmlFor="coupon_is_active" className="text-xs font-semibold text-slate-650 cursor-pointer">
                    Cupom ativo para uso?
                  </label>
                </div>

                <div className="border-t border-slate-100 pt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCouponModal(false)}
                    className="py-2.5 px-4 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold rounded-xl transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-md shadow-indigo-100 font-bold"
                  >
                    {editingCouponState ? 'Salvar Alterações' : 'Criar Cupom'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: ADD CLIENT (ADMIN) */}
        {showCustomerModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 animate-scale-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 text-lg">
                  Cadastrar Novo Cliente
                </h3>
                <button 
                  onClick={() => setShowCustomerModal(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveCustomer} className="space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Nome do Cliente</label>
                  <div className="relative">
                    <User className="absolute left-4 top-3 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Nome completo"
                      value={customerForm.name}
                      onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Apelido / Identificação Interna (Opcional)</label>
                  <div className="relative">
                    <User className="absolute left-4 top-3 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Ex: Vizinho do Zé, Dona Maria do bolo"
                      value={customerForm.nickname}
                      onChange={(e) => setCustomerForm({ ...customerForm, nickname: e.target.value })}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Grupo do Cliente (Opcional - Uso Interno)</label>
                  <div className="relative">
                    <Package className="absolute left-4 top-3 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      list="customer-group-options"
                      placeholder="Ex: Edifício Jau, Condomínio Sul"
                      value={customerForm.group_name}
                      onChange={(e) => setCustomerForm({ ...customerForm, group_name: e.target.value })}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <datalist id="customer-group-options">
                      {Array.from(new Set(adminCustomers.map(c => c.group_name).filter(Boolean))).map((g, idx) => (
                        <option key={idx} value={g} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">Telefone / WhatsApp</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-3 w-4 h-4 text-slate-400" />
                    <input
                      type="tel"
                      placeholder="(83) 99999-9999"
                      value={getFormattedPhone(customerForm.phone)}
                      onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      required
                    />
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowCustomerModal(false)}
                    className="py-2.5 px-4 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold rounded-xl transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-md shadow-indigo-100"
                  >
                    Cadastrar Cliente
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: CREATE GROUP */}
        {showCreateGroupModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 animate-scale-in flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
                <h3 className="font-bold text-slate-800 text-lg">
                  Criar Novo Grupo de Clientes
                </h3>
                <button 
                  onClick={() => setShowCreateGroupModal(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateGroup} className="space-y-4 text-sm flex-1 flex flex-col min-h-0">
                <div className="shrink-0">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Nome do Grupo</label>
                  <div className="relative">
                    <Package className="absolute left-4 top-3 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Ex: Condomínio Alfa, Bloco B"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      required
                    />
                  </div>
                </div>

                <div className="flex-1 flex flex-col min-h-0 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Selecionar Clientes Sem Grupo</label>
                    <button
                      type="button"
                      onClick={() => {
                        const eligible = adminCustomers.filter(c => !c.group_name && c.name.toLowerCase().includes(groupSearchQuery.toLowerCase()))
                        const eligibleIds = eligible.map(c => c.id)
                        const allSelected = eligibleIds.every(id => selectedGroupCustomers.includes(id))
                        if (allSelected) {
                          setSelectedGroupCustomers(prev => prev.filter(id => !eligibleIds.includes(id)))
                        } else {
                          setSelectedGroupCustomers(prev => Array.from(new Set([...prev, ...eligibleIds])))
                        }
                      }}
                      className="text-xxs text-indigo-600 hover:text-indigo-800 font-semibold"
                    >
                      {(() => {
                        const eligible = adminCustomers.filter(c => !c.group_name && c.name.toLowerCase().includes(groupSearchQuery.toLowerCase()))
                        const eligibleIds = eligible.map(c => c.id)
                        const allSelected = eligibleIds.length > 0 && eligibleIds.every(id => selectedGroupCustomers.includes(id))
                        return allSelected ? 'Desmarcar Selecionados' : 'Marcar Selecionados'
                      })()}
                    </button>
                  </div>

                  {/* Search inside modal */}
                  <div className="relative shrink-0">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Buscar cliente sem grupo..."
                      value={groupSearchQuery}
                      onChange={(e) => setGroupSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-750 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                    />
                  </div>

                  {/* Clients list */}
                  <div className="flex-1 overflow-y-auto border border-slate-100 rounded-xl p-3 bg-slate-50/50 space-y-2 min-h-24">
                    {(() => {
                      const list = adminCustomers.filter(c => !c.group_name && c.name.toLowerCase().includes(groupSearchQuery.toLowerCase()))
                      if (list.length === 0) {
                        return (
                          <div className="text-center py-6 text-slate-400 text-xs">
                            Nenhum cliente sem grupo encontrado.
                          </div>
                        )
                      }
                      return list.map(c => {
                        const isChecked = selectedGroupCustomers.includes(c.id)
                        return (
                          <label key={c.id} className="flex items-center gap-3 p-2 bg-white border border-slate-100 rounded-lg hover:bg-slate-50 transition cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setSelectedGroupCustomers(prev => prev.filter(id => id !== c.id))
                                } else {
                                  setSelectedGroupCustomers(prev => [...prev, c.id])
                                }
                              }}
                              className="rounded border-slate-350 text-indigo-600 focus:ring-indigo-500/20 w-4 h-4"
                            />
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-slate-800 block text-xs truncate">{c.name}</span>
                              {c.nickname && (
                                <span className="text-xxs text-slate-400 block truncate">Apelido: {c.nickname}</span>
                              )}
                            </div>
                          </label>
                        )
                      })
                    })()}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4 flex justify-end gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowCreateGroupModal(false)}
                    className="py-2.5 px-4 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold rounded-xl transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-md shadow-indigo-100"
                  >
                    Criar Grupo e Associar Clientes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: APPLY DISCOUNT ONLY */}
        {discountingOrder && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4 animate-scale-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 text-base">
                  Aplicar Desconto ao Pedido
                </h3>
                <button 
                  onClick={() => setDiscountingOrder(null)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl space-y-3">
                  <span className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Desconto Manual</span>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 flex rounded-xl border border-slate-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500/20">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Valor do desconto"
                        value={discountInput}
                        onChange={(e) => setDiscountInput(e.target.value)}
                        className="w-full px-3 py-2 bg-transparent text-slate-850 text-xs font-semibold focus:outline-none"
                      />
                      <div className="flex border-l border-slate-200 font-semibold text-xs">
                        <button
                          type="button"
                          onClick={() => setDiscountType('fixed')}
                          className={`px-3 py-2 transition ${discountType === 'fixed' ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                        >
                          R$
                        </button>
                        <button
                          type="button"
                          onClick={() => setDiscountType('percentage')}
                          className={`px-3 py-2 transition ${discountType === 'percentage' ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                        >
                          %
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {(() => {
                  const subtotal = discountingOrder.order_items.reduce((total, item) => {
                    const price = item.price_final !== null ? item.price_final : (item.price_unit * item.quantity_requested)
                    return total + price
                  }, 0)
                  const discVal = parseFloat(discountInput) || 0
                  const calculatedDisc = discountType === 'percentage' ? subtotal * (discVal / 100) : discVal
                  const finalTotal = Math.max(0, subtotal - calculatedDisc)

                  return (
                    <div className="space-y-3">
                      <div className="bg-slate-50 p-3 rounded-xl space-y-1.5 text-xxs font-semibold text-slate-550 border border-slate-100">
                        <div className="flex justify-between">
                          <span>Subtotal do Pedido:</span>
                          <span className="text-slate-800 font-mono">R$ {subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        {calculatedDisc > 0 && (
                          <div className="flex justify-between text-emerald-600">
                            <span>Desconto Calculado:</span>
                            <span className="font-mono">- R$ {calculatedDisc.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-slate-200/60 pt-1.5 text-xs text-slate-800 font-bold">
                          <span>Total Final:</span>
                          <span className="font-mono text-sm text-slate-900">R$ {finalTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setDiscountingOrder(null)}
                          className="flex-1 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold rounded-xl transition"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={saveOrderDiscount}
                          className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-md shadow-indigo-100"
                        >
                          Salvar Desconto
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {/* MODAL: ADJUST WEIGHTS */}
        {adjustingOrder && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4 animate-scale-in">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 text-lg">
                  Ajustar Quantidades/Pesos Reais
                </h3>
                <button 
                  onClick={() => setAdjustingOrder(null)}
                  className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-slate-400 text-xs leading-relaxed">
                Digite a quantidade ou o peso real aferido na balança para cada produto fracionado. Os valores fixos já estão preenchidos.
              </p>

              <div className="space-y-4 my-4 max-h-72 overflow-y-auto">
                {adjustingOrder.order_items.map((item) => (
                  <div key={item.id} className="bg-slate-50 border border-slate-100 p-3 rounded-xl flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <span className="font-semibold text-slate-700 block text-xs">{item.products?.name}</span>
                      <span className="text-xxs text-slate-400 font-mono">
                        Solicitado: {item.is_approximate ? parseFloat(item.quantity_requested).toFixed(3) : item.quantity_requested} {item.products?.unit} (R$ {(item.price_unit * item.quantity_requested).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step={item.products?.unit === 'kg' ? '0.001' : '1'}
                        value={adjustingQuantities[item.id] !== undefined ? adjustingQuantities[item.id] : ''}
                        onChange={(e) => handleAdjustQtyChange(item.id, e.target.value)}
                        disabled={!item.is_approximate}
                        onFocus={(e) => e.target.select()}
                        className={`w-24 px-3 py-1.5 border rounded-lg text-slate-800 focus:outline-none text-center font-semibold font-mono text-sm ${item.is_approximate ? 'border-amber-300 bg-amber-50/20 focus:ring-2 focus:ring-amber-500/20' : 'border-slate-200 bg-slate-100 text-slate-400'}`}
                      />
                      <span className="text-xs font-mono text-slate-500 w-8">{item.products?.unit}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Discount inputs */}
              <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl space-y-3">
                <span className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Aplicar Desconto ao Pedido</span>
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex rounded-xl border border-slate-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500/20">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Valor do desconto"
                      value={adminOrderDiscountInput}
                      onChange={(e) => setAdminOrderDiscountInput(e.target.value)}
                      className="w-full px-3 py-2 bg-transparent text-slate-800 text-xs font-semibold focus:outline-none"
                    />
                    <div className="flex border-l border-slate-200 font-semibold text-xs">
                      <button
                        type="button"
                        onClick={() => setAdminOrderDiscountType('fixed')}
                        className={`px-3 py-2 transition ${adminOrderDiscountType === 'fixed' ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                      >
                        R$
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminOrderDiscountType('percentage')}
                        className={`px-3 py-2 transition ${adminOrderDiscountType === 'percentage' ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                      >
                        %
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 flex flex-col gap-1">
                {(() => {
                  const subtotal = Object.keys(adjustingQuantities).reduce((total, id) => {
                    const item = adjustingOrder.order_items.find(i => i.id === id)
                    if (!item) return total
                    const qty = parseFloat(adjustingQuantities[id]) || 0
                    return total + (qty * item.price_unit)
                  }, 0)
                  const discVal = parseFloat(adminOrderDiscountInput) || 0
                  const calculatedDisc = adminOrderDiscountType === 'percentage' ? subtotal * (discVal / 100) : discVal
                  const finalTotal = Math.max(0, subtotal - calculatedDisc)

                  return (
                    <div className="flex justify-between items-center w-full">
                      <div className="text-left space-y-0.5">
                        <span className="text-xxs text-slate-400 block font-semibold">Subtotal: R$ {subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        {calculatedDisc > 0 && (
                          <span className="text-xxs text-emerald-600 block font-semibold">Desconto: - R$ {calculatedDisc.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({adminOrderDiscountType === 'percentage' ? `${discVal}%` : 'R$'})</span>
                        )}
                        <span className="text-xxs text-slate-400 block font-semibold">Novo Total do Pedido</span>
                        <span className="text-base font-bold text-slate-800">
                          R$ {finalTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAdjustingOrder(null)}
                          className="py-2.5 px-4 border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold rounded-xl transition"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={saveOrderAdjustments}
                          className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-md shadow-indigo-100"
                        >
                          Salvar Ajustes
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}


        {/* TAB 5: FINANCEIRO */}
        {adminTab === 'financeiro' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6">
              {/* inline chart implementation */}
              {(() => {
                const getFinanceChartData = () => {
                  const deliveredOrders = orders.filter(o => o.status === 'delivered' && o.created_at);
                  const now = new Date();
                  const getStartOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
                  
                  let labels = [];
                  let values = [];
                  
                  if (financeFilter === '7d') {
                    for (let i = 6; i >= 0; i--) {
                      const d = new Date();
                      d.setDate(now.getDate() - i);
                      const dayStart = getStartOfDay(d);
                      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
                      labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
                      values.push(deliveredOrders.filter(o => {
                        const oDate = new Date(o.created_at);
                        return oDate >= dayStart && oDate < dayEnd;
                      }).reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0));
                    }
                  } else if (financeFilter === '30d') {
                    for (let i = 29; i >= 0; i--) {
                      const d = new Date();
                      d.setDate(now.getDate() - i);
                      const dayStart = getStartOfDay(d);
                      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
                      labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit' }));
                      values.push(deliveredOrders.filter(o => {
                        const oDate = new Date(o.created_at);
                        return oDate >= dayStart && oDate < dayEnd;
                      }).reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0));
                    }
                  } else if (financeFilter === '3m') {
                    for (let i = 11; i >= 0; i--) {
                      const d = new Date();
                      d.setDate(now.getDate() - (i * 7));
                      const dayOfWeek = d.getDay();
                      const startOfWeek = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayOfWeek);
                      const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
                      labels.push(`S${12-i}`);
                      values.push(deliveredOrders.filter(o => {
                        const oDate = new Date(o.created_at);
                        return oDate >= startOfWeek && oDate < endOfWeek;
                      }).reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0));
                    }
                  } else if (financeFilter === '6m') {
                    for (let i = 5; i >= 0; i--) {
                      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
                      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
                      labels.push(d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''));
                      values.push(deliveredOrders.filter(o => {
                        const oDate = new Date(o.created_at);
                        return oDate >= monthStart && oDate < monthEnd;
                      }).reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0));
                    }
                  } else if (financeFilter === '12m') {
                    for (let i = 11; i >= 0; i--) {
                      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
                      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1);
                      labels.push(d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''));
                      values.push(deliveredOrders.filter(o => {
                        const oDate = new Date(o.created_at);
                        return oDate >= monthStart && oDate < monthEnd;
                      }).reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0));
                    }
                  }
                  return { labels, values };
                };

                const { labels, values } = getFinanceChartData();
                const maxValue = Math.max(...values, 100);
                const width = 500;
                const height = 200;
                const paddingLeft = 40;
                const paddingRight = 10;
                const paddingTop = 20;
                const paddingBottom = 30;
                const chartWidth = width - paddingLeft - paddingRight;
                const chartHeight = height - paddingTop - paddingBottom;
                const barWidth = chartWidth / labels.length;

                return (
                  <div className="bg-slate-900 text-slate-100 p-6 rounded-2xl border border-slate-800 shadow-md">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <span className="text-xxs font-bold text-indigo-400 uppercase tracking-wider font-mono">Faturamento do Período</span>
                        <h3 className="text-xl font-bold font-mono">
                          R$ {values.reduce((a, b) => a + b, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </h3>
                      </div>
                      <div className="flex bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-xxs font-semibold font-mono">
                        {['7d', '30d', '3m', '6m', '12m'].map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setFinanceFilter(f)}
                            className={`px-2.5 py-1 rounded transition ${financeFilter === f ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                          >
                            {f.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="relative h-56 w-full">
                      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
                        {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                          const y = paddingTop + chartHeight * (1 - ratio);
                          const val = maxValue * ratio;
                          return (
                            <g key={idx}>
                              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="#1e293b" strokeWidth="1" strokeDasharray="4 4" />
                              <text x={paddingLeft - 8} y={y + 3} fill="#64748b" fontSize="8" textAnchor="end" className="font-mono font-semibold">
                                {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}
                              </text>
                            </g>
                          );
                        })}
                        {labels.map((label, idx) => {
                          const val = values[idx];
                          const barHeight = (val / maxValue) * chartHeight;
                          const x = paddingLeft + idx * barWidth + (barWidth * 0.15);
                          const actualBarWidth = barWidth * 0.7;
                          const y = paddingTop + chartHeight - barHeight;
                          return (
                            <g key={idx} className="group">
                              <rect
                                x={x}
                                y={y}
                                width={actualBarWidth}
                                height={Math.max(barHeight, 2)}
                                fill={val > 0 ? "url(#indigoGrad)" : "#334155"}
                                rx="2"
                                className="transition-all duration-300 hover:fill-indigo-400 cursor-pointer"
                                onMouseEnter={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const containerRect = e.currentTarget.closest('.relative').getBoundingClientRect();
                                  setHoveredBar({
                                    label,
                                    value: val,
                                    x: rect.left - containerRect.left + rect.width / 2,
                                    y: rect.top - containerRect.top
                                  })
                                }}
                                onMouseLeave={() => setHoveredBar(null)}
                              />
                              {(financeFilter !== '30d' || idx % 5 === 0) && (
                                <text x={x + actualBarWidth / 2} y={height - paddingBottom + 12} fill="#64748b" fontSize="8" textAnchor="middle" className="font-mono font-semibold">
                                  {label}
                                </text>
                              )}
                            </g>
                          );
                        })}
                        <defs>
                          <linearGradient id="indigoGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" />
                            <stop offset="100%" stopColor="#4f46e5" />
                          </linearGradient>
                        </defs>
                      </svg>
                      {hoveredBar && (
                        <div
                          className="absolute bg-slate-950 text-white px-2.5 py-1.5 rounded-lg text-xxs font-mono border border-slate-800 shadow-xl pointer-events-none -translate-x-1/2 -translate-y-[110%] z-10 transition-all duration-75 flex flex-col items-center gap-0.5"
                          style={{
                            left: `${hoveredBar.x}px`,
                            top: `${hoveredBar.y}px`
                          }}
                        >
                          <span className="text-slate-400 font-semibold">{hoveredBar.label}</span>
                          <span className="font-bold text-indigo-400">
                            {Number(hoveredBar.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              
              {/* Sales History table */}
              <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 text-base">Histórico de Vendas</h3>
                  <span className="text-xxs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg font-mono font-semibold">
                    {orders.filter(o => o.status === 'delivered').length} venda(s) concluída(s)
                  </span>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-semibold font-mono text-xxs uppercase tracking-wider">
                        <th className="py-3 px-4">Pedido ID</th>
                        <th className="py-3 px-4">Cliente</th>
                        <th className="py-3 px-4">Data</th>
                        <th className="py-3 px-4">Itens</th>
                        <th className="py-3 px-4 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {orders
                        .filter(o => o.status === 'delivered')
                        .map((ord) => (
                          <tr key={ord.id} className="hover:bg-slate-50/50">
                            <td className="py-3.5 px-4 font-mono text-xxs font-bold text-indigo-600">
                              #{ord.id.substring(0, 8).toUpperCase()}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="font-bold text-slate-700 block">{ord.customers?.name || 'Cliente'}</span>
                              <span className="text-xxs text-slate-400 font-mono block">{getFormattedPhone(ord.customers?.phone)}</span>
                              {ord.notes && (
                                <span className="text-xxs text-amber-600 block mt-1 leading-normal"><strong>Obs:</strong> {ord.notes}</span>
                              )}
                              {ord.rating_comment && (
                                <span className="text-xxs text-indigo-500 italic block mt-1 flex items-center gap-1 leading-normal">
                                  <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 shrink-0" /> "{ord.rating_comment}"
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-xs text-slate-500">
                              {new Date(ord.created_at).toLocaleString('pt-BR')}
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs truncate">
                              {ord.order_items.map(item => {
                                const qty = item.quantity_final !== null ? item.quantity_final : item.quantity_requested;
                                const unit = item.products?.unit || 'un';
                                return `${unit === 'kg' ? qty.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + 'kg' : qty} ${item.products?.name || 'Item'}`;
                              }).join(', ')}
                            </td>
                            <td className="py-3.5 px-4 text-right font-bold text-slate-800">
                              R$ {ord.total_price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 7: MEU PERFIL */}
        {adminTab === 'profile' && (
          <form onSubmit={handleSaveAdminProfile} className="space-y-6 max-w-md mx-auto w-full bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
            <div>
              <h2 className="text-xl font-bold text-slate-800 mb-1">Meu Perfil do Administrador</h2>
              <p className="text-slate-400 text-xs leading-relaxed">
                Altere seus dados de identificação e login do painel administrativo.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Nome do Administrador</label>
                <input
                  type="text"
                  required
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Telefone (WhatsApp Login)</label>
                <input
                  type="text"
                  required
                  value={adminPhone}
                  onChange={(e) => setAdminPhone(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="py-3 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition shadow-md shadow-indigo-100 flex items-center justify-center gap-2"
              >
                Salvar Perfil
              </button>
            </div>
          </form>
        )}
        </main>
      </div>
    )
  }
}

  return (
    <>
      {renderPageContent()}

      {/* MODAL: SELECT MESSAGE OPTION ON DELIVERY */}
      {deliveringOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4 animate-scale-in text-center">
            <div className="mx-auto w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center shadow-inner">
              <MessageSquare className="w-6 h-6" />
            </div>
            
            <div className="space-y-1">
              <h3 className="font-bold text-slate-800 text-base">Mensagem de Finalização</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Escolha o formato da mensagem de notificação para enviar ao cliente #{deliveringOrder.id.substring(0, 8).toUpperCase()}:
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              {deliveringOrder.payment_status !== 'paid' && (
                <button
                  onClick={() => {
                    const order = deliveringOrder;
                    setDeliveringOrder(null);
                    if (order.status !== 'delivered') {
                      markAsDeliveredQuery(order, true, true);
                    } else {
                      sendWhatsAppMessage(order, true);
                    }
                  }}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-2"
                >
                  <DollarSign className="w-4 h-4" />
                  Mensagem COM Cobrança (Pix)
                </button>
              )}
              
              <button
                onClick={() => {
                  const order = deliveringOrder;
                  setDeliveringOrder(null);
                  if (order.status !== 'delivered') {
                    markAsDeliveredQuery(order, false, true);
                  } else {
                    sendWhatsAppMessage(order, false);
                  }
                }}
                className={`w-full py-3 font-semibold rounded-xl text-xs transition flex items-center justify-center gap-2 ${
                  deliveringOrder.payment_status === 'paid'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm border border-transparent'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                }`}
              >
                <Check className={`w-4 h-4 ${deliveringOrder.payment_status === 'paid' ? 'text-white' : 'text-emerald-600'}`} />
                Mensagem SEM Cobrança
              </button>

              <button
                onClick={() => {
                  const order = deliveringOrder;
                  setDeliveringOrder(null);
                  if (order.status !== 'delivered') {
                    markAsDeliveredQuery(order, false, false);
                  } else {
                    addToast('Este pedido já consta como entregue.', 'info');
                  }
                }}
                className="w-full py-3 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-2"
              >
                <CheckSquare className="w-4 h-4 text-emerald-400" />
                Dar Baixa (Sem Mensagem)
              </button>
              
              <button
                onClick={() => setDeliveringOrder(null)}
                className="w-full py-2.5 text-slate-400 hover:text-slate-600 font-semibold rounded-xl text-xs transition mt-1"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AGGREGATED ITEM REPORT */}
      {showItemReportModal && (() => {
        // Calculate filteredOrders for 'current' filter context
        const filteredCurrentOrders = orders.filter((order) => {
          let matchesTab = false;
          if (adminOrderSubTab === 'pending') {
            matchesTab = order.status !== 'delivered' && !order.is_assembled;
          } else if (adminOrderSubTab === 'assembled') {
            matchesTab = order.status !== 'delivered' && order.is_assembled;
          } else if (adminOrderSubTab === 'delivered') {
            matchesTab = order.status === 'delivered';
          }
          const clientName = order.customers?.name || '';
          const matchesSearch = clientName.toLowerCase().includes(orderSearchQuery.toLowerCase());
          
          let matchesPayment = true;
          if (adminOrderSubTab === 'delivered') {
            if (adminOrderPaymentFilter === 'paid') {
              matchesPayment = order.payment_status === 'paid';
            } else if (adminOrderPaymentFilter === 'pending') {
              matchesPayment = order.payment_status !== 'paid';
            }
          }

          let matchesGroup = true;
          if (adminOrderGroupFilter === 'none') {
            matchesGroup = !order.customers?.group_name;
          } else if (adminOrderGroupFilter !== 'all') {
            matchesGroup = order.customers?.group_name && order.customers.group_name.trim().toLowerCase() === adminOrderGroupFilter.trim().toLowerCase();
          }
          
          return matchesTab && matchesSearch && matchesPayment && matchesGroup;
        });

        let targetOrders = [];
        if (itemReportFilter === 'current') {
          targetOrders = filteredCurrentOrders;
        } else if (itemReportFilter === 'pending') {
          targetOrders = orders.filter(o => o.status !== 'delivered' && !o.is_assembled);
        } else if (itemReportFilter === 'assembled') {
          targetOrders = orders.filter(o => o.status !== 'delivered' && o.is_assembled);
        } else if (itemReportFilter === 'delivered') {
          targetOrders = orders.filter(o => o.status === 'delivered');
        } else {
          targetOrders = orders.filter(o => o.status !== 'cancelled');
        }

        const getEggTrayDetails = (name, totalQty) => {
          if (!name) return null;
          const match = name.match(/(\d+)\s*ovos?/i);
          if (match) {
            const countPerUnit = parseInt(match[1], 10);
            if (!isNaN(countPerUnit) && countPerUnit > 0) {
              const totalEggs = Math.round(totalQty * countPerUnit);
              const trays15 = totalEggs / 15;
              return {
                countPerUnit,
                totalEggs,
                trays15,
                isInteger15: Number.isInteger(trays15)
              };
            }
          } else if (name.toLowerCase().includes('ovo')) {
            const totalEggs = Math.round(totalQty * 15);
            return {
              countPerUnit: 15,
              totalEggs,
              trays15: totalQty,
              isInteger15: Number.isInteger(totalQty)
            };
          }
          return null;
        };

        // Aggregate items
        const aggregatedMap = {};
        targetOrders.forEach(order => {
          if (order.status === 'cancelled') return;
          if (Array.isArray(order.order_items)) {
            order.order_items.forEach(item => {
              const prodName = item.products?.name || 'Item';
              const unit = item.products?.unit || 'un';
              const key = item.product_id ? `id_${item.product_id}` : `name_${prodName}_${unit}`;
              const qty = (item.quantity_final !== null && item.quantity_final !== undefined)
                ? item.quantity_final
                : (item.quantity_requested !== undefined ? item.quantity_requested : (item.quantity || 0));

              if (!aggregatedMap[key]) {
                aggregatedMap[key] = {
                  id: key,
                  name: prodName,
                  unit: unit,
                  totalQty: 0,
                  orderCount: 0
                };
              }
              aggregatedMap[key].totalQty += Number(qty) || 0;
              aggregatedMap[key].orderCount += 1;
            });
          }
        });

        const aggregatedList = Object.values(aggregatedMap).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

        let totalAllEggs = 0;
        aggregatedList.forEach(item => {
          const eggInfo = getEggTrayDetails(item.name, item.totalQty);
          if (eggInfo) {
            totalAllEggs += eggInfo.totalEggs;
          }
        });
        const totalAllTrays15 = totalAllEggs / 15;

        const handleCopyTextReport = () => {
          const filterLabelMap = {
            current: 'Filtro Atual da Tela',
            pending: 'Entrega Pendente',
            assembled: 'Montados',
            delivered: 'Entregues',
            all: 'Todos os Pedidos'
          };

          let text = `📋 *RELATÓRIO DE ITENS SOLICITADOS*\n`;
          text += `Contexto: ${filterLabelMap[itemReportFilter] || 'Geral'}\n`;
          text += `Total de Pedidos: ${targetOrders.length}\n`;
          text += `------------------------------------\n`;

          if (aggregatedList.length === 0) {
            text += `Nenhum item encontrado nos pedidos.`;
          } else {
            aggregatedList.forEach(item => {
              const eggInfo = getEggTrayDetails(item.name, item.totalQty);
              let qtyStr = '';
              if (eggInfo) {
                const traysStr = eggInfo.isInteger15 
                  ? Math.round(eggInfo.trays15) 
                  : eggInfo.trays15.toFixed(1);
                qtyStr = `${traysStr} bandeja(s) de 15 (${eggInfo.totalEggs} ovos)`;
              } else if (item.unit === 'kg') {
                qtyStr = item.totalQty.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg';
              } else {
                qtyStr = `${Math.round(item.totalQty)} ${item.unit || 'un'}(s)`;
              }
              text += `• ${qtyStr} - ${item.name} (${item.orderCount} pedido${item.orderCount > 1 ? 's' : ''})\n`;
            });
          }

          if (totalAllEggs > 0) {
            const totalTraysStr = Number.isInteger(totalAllTrays15) 
              ? Math.round(totalAllTrays15) 
              : totalAllTrays15.toFixed(1);
            text += `------------------------------------\n`;
            text += `🥚 *TOTAL GERAL DE OVOS:* ${totalTraysStr} bandeja(s) de 15 (${totalAllEggs} ovos no total)\n`;
          }

          if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
            setItemReportCopied(true);
            setTimeout(() => setItemReportCopied(false), 2500);
            addToast('Relatório copiado para a área de transferência!', 'success');
          }
        };

        return (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl p-6 space-y-4 max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-start justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                    <ClipboardList className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg">Total de Itens dos Pedidos</h3>
                    <p className="text-xs text-slate-500">Resumo consolidado de produtos para separação e estoque</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowItemReportModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Filter Sub-nav inside Modal */}
              <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl text-xs">
                <button
                  onClick={() => setItemReportFilter('current')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${itemReportFilter === 'current' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Filtro Atual ({filteredCurrentOrders.length})
                </button>
                <button
                  onClick={() => setItemReportFilter('pending')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${itemReportFilter === 'pending' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Pendentes ({orders.filter(o => o.status !== 'delivered' && !o.is_assembled).length})
                </button>
                <button
                  onClick={() => setItemReportFilter('assembled')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${itemReportFilter === 'assembled' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Montados ({orders.filter(o => o.status !== 'delivered' && o.is_assembled).length})
                </button>
                <button
                  onClick={() => setItemReportFilter('delivered')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${itemReportFilter === 'delivered' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Entregues ({orders.filter(o => o.status === 'delivered').length})
                </button>
                <button
                  onClick={() => setItemReportFilter('all')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${itemReportFilter === 'all' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Todos ({orders.filter(o => o.status !== 'cancelled').length})
                </button>
              </div>

              {/* Items List Content */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-2 max-h-[50vh]">
                {aggregatedList.length === 0 ? (
                  <div className="py-12 text-center text-slate-400">
                    <Package className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-600">Nenhum item para os pedidos deste filtro.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {aggregatedList.map((item, idx) => {
                      const eggInfo = getEggTrayDetails(item.name, item.totalQty);
                      let qtyFormatted = '';
                      if (eggInfo) {
                        const traysStr = eggInfo.isInteger15 
                          ? Math.round(eggInfo.trays15) 
                          : eggInfo.trays15.toFixed(1);
                        qtyFormatted = `${traysStr} bandeja(s) de 15`;
                      } else if (item.unit === 'kg') {
                        qtyFormatted = item.totalQty.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg';
                      } else {
                        qtyFormatted = `${Math.round(item.totalQty)} ${item.unit || 'un'}(s)`;
                      }

                      return (
                        <div key={idx} className="py-2.5 flex items-center justify-between gap-4">
                          <div>
                            <p className="font-bold text-slate-800 text-sm">{item.name}</p>
                            <p className="text-xxs text-slate-400 font-medium">
                              Presente em {item.orderCount} pedido(s)
                              {eggInfo && ` • Total: ${eggInfo.totalEggs} ovos (${Math.round(item.totalQty)} un do item)`}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="inline-block px-3 py-1 bg-indigo-50 text-indigo-700 font-bold text-sm rounded-lg border border-indigo-100/60 font-mono">
                              {qtyFormatted}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-500 font-medium">
                  <div><strong>{aggregatedList.length}</strong> tipo(s) de produto em <strong>{targetOrders.length}</strong> pedido(s)</div>
                  {totalAllEggs > 0 && (
                    <div className="text-indigo-600 font-bold mt-0.5">
                      🥚 Total em Ovos: {Number.isInteger(totalAllTrays15) ? Math.round(totalAllTrays15) : totalAllTrays15.toFixed(1)} bandeja(s) de 15 ({totalAllEggs} ovos)
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyTextReport}
                    disabled={aggregatedList.length === 0}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition shadow-sm flex items-center gap-1.5"
                  >
                    {itemReportCopied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                    {itemReportCopied ? 'Copiado!' : 'Copiar Resumo'}
                  </button>
                  <button
                    onClick={() => setShowItemReportModal(false)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL: ADMIN EDIT CUSTOMER */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleAdminSaveCustomer} className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4 animate-scale-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                <User className="w-5 h-5 text-indigo-600" />
                Editar Cadastro do Cliente
              </h3>
              <button 
                type="button"
                onClick={() => setEditingCustomer(null)}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={adminCustomerForm.name}
                  onChange={(e) => setAdminCustomerForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Grupo do Cliente (Opcional - Uso Interno)</label>
                <input
                  type="text"
                  list="edit-customer-group-options"
                  placeholder="Ex: Edifício Jau, Condomínio Sul"
                  value={adminCustomerForm.group_name}
                  onChange={(e) => setAdminCustomerForm(prev => ({ ...prev, group_name: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <datalist id="edit-customer-group-options">
                  {Array.from(new Set(adminCustomers.map(c => c.group_name).filter(Boolean))).map((g, idx) => (
                    <option key={idx} value={g} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Telefone (WhatsApp)</label>
                <input
                  type="text"
                  required
                  value={adminCustomerForm.phone}
                  onChange={(e) => setAdminCustomerForm(prev => ({ ...prev, phone: e.target.value.replace(/\D/g, '') }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 relative">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">CEP</label>
                  <input
                    type="text"
                    required
                    placeholder="00000-000"
                    value={getFormattedCep(adminCustomerForm.cep)}
                    onChange={handleAdminCustomerCepChange}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                  />
                  {cepLoading && (
                    <span className="absolute right-3.5 bottom-3">
                      <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
                    </span>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Estado</label>
                  <input
                    type="text"
                    required
                    placeholder="UF"
                    value={adminCustomerForm.state}
                    onChange={(e) => setAdminCustomerForm(prev => ({ ...prev, state: e.target.value.toUpperCase() }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Cidade</label>
                  <input
                    type="text"
                    required
                    value={adminCustomerForm.city}
                    onChange={(e) => setAdminCustomerForm(prev => ({ ...prev, city: e.target.value }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Número</label>
                  <input
                    type="text"
                    required
                    value={adminCustomerForm.number}
                    onChange={(e) => setAdminCustomerForm(prev => ({ ...prev, number: e.target.value }))}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Rua / Logradouro</label>
                <input
                  type="text"
                  required
                  value={adminCustomerForm.street}
                  onChange={(e) => setAdminCustomerForm(prev => ({ ...prev, street: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Bairro</label>
                <input
                  type="text"
                  required
                  value={adminCustomerForm.neighborhood}
                  onChange={(e) => setAdminCustomerForm(prev => ({ ...prev, neighborhood: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Complemento</label>
                <input
                  type="text"
                  placeholder="Ex: Apto 101, Bloco B"
                  value={adminCustomerForm.complement}
                  onChange={(e) => setAdminCustomerForm(prev => ({ ...prev, complement: e.target.value }))}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingCustomer(null)}
                className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-500 font-semibold rounded-xl text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs transition shadow-sm"
              >
                Salvar Cadastro
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADMIN EDIT NICKNAME */}
      {editingNicknameCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleAdminSaveNickname} className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4 animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                <Tag className="w-5 h-5 text-indigo-600" />
                Definir Apelido do Cliente
              </h3>
              <button 
                type="button"
                onClick={() => setEditingNicknameCustomer(null)}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-slate-500 leading-relaxed">
                Defina um apelido para identificar <strong>{editingNicknameCustomer.name}</strong> internamente no sistema. O cliente não verá esta informação.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Apelido (Identificação Interna)</label>
                <input
                  type="text"
                  placeholder="Ex: Vizinho do Zé, Dona Maria do bolo"
                  value={adminNicknameForm}
                  onChange={(e) => setAdminNicknameForm(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 font-medium"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingNicknameCustomer(null)}
                className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-500 font-semibold rounded-xl text-xs transition"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-xs transition shadow-sm"
              >
                Salvar Apelido
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: EVALUATE ORDER (CLIENT) */}
      {orderToEvaluate && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`${theme.cardBg} w-full max-w-sm p-6 space-y-4 animate-scale-in`}>
            <div className={`flex items-center justify-between border-b ${theme.lightBorder} pb-3`}>
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                <Star className="w-5 h-5 text-amber-500 fill-amber-400" />
                Avaliar Pedido
              </h3>
              <button 
                onClick={() => {
                  const dismissed = JSON.parse(localStorage.getItem('dismissed_ratings') || '[]')
                  if (!dismissed.includes(orderToEvaluate.id)) {
                    dismissed.push(orderToEvaluate.id)
                    localStorage.setItem('dismissed_ratings', JSON.stringify(dismissed))
                  }
                  setOrderToEvaluate(null)
                }}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-slate-600 text-xs text-center leading-relaxed">
                Como foi a sua experiência com o pedido <span className="font-mono font-bold text-slate-700">#{orderToEvaluate.id.substring(0,8).toUpperCase()}</span>? Sua opinião é muito importante para nós!
              </p>

              {/* Stars Selector */}
              <div className="flex justify-center items-center gap-2 py-2">
                {[1, 2, 3, 4, 5].map((star) => {
                  const isLit = star <= (hoveredStar || evaluationRating);
                  return (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setEvaluationRating(star)}
                      onMouseEnter={() => setHoveredStar(star)}
                      onMouseLeave={() => setHoveredStar(0)}
                      className="p-1 text-slate-300 hover:scale-110 transition cursor-pointer"
                    >
                      <Star 
                        className={`w-8 h-8 ${isLit ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} 
                      />
                    </button>
                  )
                })}
              </div>

              <div className="space-y-1">
                <label className="text-xxs font-bold text-slate-400 uppercase tracking-wider font-mono">Comentário (opcional)</label>
                <textarea
                  value={evaluationComment}
                  onChange={(e) => setEvaluationComment(e.target.value)}
                  placeholder="Escreva um comentário sobre os produtos, a entrega ou o atendimento..."
                  rows="3"
                  className={`w-full px-3 py-2 border ${theme.lightBorder} ${theme.inputBg} rounded-xl text-slate-800 text-xs focus:outline-none focus:ring-2 ${theme.focusRing} ${theme.focusBorder}`}
                ></textarea>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  const dismissed = JSON.parse(localStorage.getItem('dismissed_ratings') || '[]')
                  if (!dismissed.includes(orderToEvaluate.id)) {
                    dismissed.push(orderToEvaluate.id)
                    localStorage.setItem('dismissed_ratings', JSON.stringify(dismissed))
                  }
                  setOrderToEvaluate(null)
                }}
                className={`flex-1 py-2.5 border ${theme.lightBorder} text-slate-600 ${theme.lightHoverBg} text-xs font-semibold rounded-xl transition`}
              >
                Depois
              </button>
              <button
                onClick={() => submitRating(orderToEvaluate.id, evaluationRating, evaluationComment)}
                disabled={evaluationRating === 0}
                className={`flex-1 py-2.5 ${theme.bg} ${theme.hoverBg} text-white text-xs font-semibold rounded-xl transition shadow-md ${theme.shadowColor} disabled:opacity-50`}
              >
                Enviar Avaliação
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation / Alert Modal */}
      {confirmModal.show && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-100 animate-scale-in relative">
            <button
              type="button"
              onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2.5 rounded-xl ${confirmModal.isAlert ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>
                  <Info className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 pr-6">{confirmModal.title}</h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed pl-1">
                {confirmModal.message}
              </p>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
              {!confirmModal.isAlert && (
                <button
                  type="button"
                  onClick={confirmModal.onCancel}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
                >
                  {confirmModal.cancelText}
                </button>
              )}
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition shadow-sm"
              >
                {confirmModal.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST CONTAINER */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-4 rounded-xl shadow-lg border text-white pointer-events-auto flex items-start justify-between gap-3 animate-slide-in ${
              toast.type === 'error' 
                ? 'bg-red-600 border-red-500' 
                : toast.type === 'info' 
                  ? 'bg-blue-600 border-blue-500' 
                  : 'bg-emerald-600 border-emerald-500'
            }`}
          >
            <div className="flex-1 text-xs font-semibold leading-relaxed">
              {toast.message}
            </div>
            <button
              type="button"
              onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
              className="text-white hover:text-slate-200 transition shrink-0 p-0.5 rounded-lg hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

export default App
