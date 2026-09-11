<script lang="ts">
  import {
    Play,
    Pause,
    SkipBack,
    SkipForward,
    Shuffle,
    Repeat,
    Repeat1,
    VolumeX,
    Volume1,
    Volume2,
    Volume,
    Heart,
    Home,
    Music,
    Music2,
    Disc3,
    Disc,
    User,
    Users,
    ListMusic,
    Search,
    List,
    Mic2,
    Plug,
    Cast,
    Moon,
    Timer,
    Pin,
    Power,
    RefreshCw,
    CloudOff,
    CheckCircle,
    Info,
    AlertTriangle,
    AlertCircle,
    Check,
    X,
    Loader2,
    ChevronDown,
    ChevronUp,
    ChevronLeft,
    ChevronRight,
    GripVertical,
    Download,
    Upload,
    Maximize2,
    Minimize2,
    Sparkles,
    Speaker,
    Headphones,
    Settings,
    Folder,
    Trash2,
    Pencil,
    ExternalLink,
    Plus,
    Minus,
    Eye,
    EyeOff,
    Globe,
    Gem,
    Keyboard,
    Zap,
    HelpCircle,
    Copy,
    MoreVertical,
    MoreHorizontal,
    Shield,
    Radio,
    Flame,
    Compass,
    Library,
    Sliders,
    ArrowUpDown,
    Clock,
    Share2,
    FileText,
    Monitor,
    BarChart2,
    Star,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowDown,
    Tag
  } from 'lucide-svelte';

  export let name:
    | 'tag'
    | 'arrow-left'
    | 'arrow-right'
    | 'arrow-up'
    | 'arrow-down'
    | 'play'
    | 'pause'
    | 'skip-back'
    | 'skip-forward'
    | 'shuffle'
    | 'repeat'
    | 'repeat-1'
    | 'volume-x'
    | 'volume-mute'
    | 'volume-1'
    | 'volume-low'
    | 'volume-2'
    | 'volume'
    | 'heart'
    | 'heart-filled'
    | 'home'
    | 'music'
    | 'music-2'
    | 'disc'
    | 'disc-3'
    | 'user'
    | 'users'
    | 'list-music'
    | 'playlist'
    | 'search'
    | 'queue'
    | 'list'
    | 'lyrics'
    | 'mic-2'
    | 'plugin'
    | 'connect'
    | 'cast'
    | 'sleep-timer'
    | 'moon'
    | 'timer'
    | 'pin'
    | 'power'
    | 'sync'
    | 'refresh'
    | 'sync-error'
    | 'cloud-off'
    | 'check-circle'
    | 'info'
    | 'alert-triangle'
    | 'alert-circle'
    | 'check'
    | 'x'
    | 'loader'
    | 'chevron-down'
    | 'chevron-up'
    | 'chevron-left'
    | 'chevron-right'
    | 'drag-handle'
    | 'downloaded'
    | 'download'
    | 'upload'
    | 'fullscreen'
    | 'maximize'
    | 'minimize'
    | 'sparkles'
    | 'speaker'
    | 'headphone'
    | 'headphones'
    | 'settings'
    | 'folder'
    | 'trash'
    | 'edit'
    | 'external-link'
    | 'plus'
    | 'minus'
    | 'eye'
    | 'eye-off'
    | 'globe'
    | 'gem'
    | 'keyboard'
    | 'zap'
    | 'help-circle'
    | 'copy'
    | 'more-vertical'
    | 'more-horizontal'
    | 'shield'
    | 'radio'
    | 'flame'
    | 'compass'
    | 'library'
    | 'sliders'
    | 'arrow-up-down'
    | 'clock'
    | 'share'
    | 'file-text'
    | 'monitor'
    | string;

  export let size: number | string = 16;
  export let strokeWidth: number = 2;
  export let className: string = '';

  const sizeMap: Record<string, number> = {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 24,
    '2xl': 32
  };

  $: px = typeof size === 'number' ? size : (sizeMap[size] ?? 16);

  const iconMap: Record<string, any> = {
    play: Play,
    pause: Pause,
    'skip-back': SkipBack,
    'skip-forward': SkipForward,
    shuffle: Shuffle,
    repeat: Repeat,
    'repeat-1': Repeat1,
    'volume-x': VolumeX,
    'volume-mute': VolumeX,
    'volume-1': Volume1,
    'volume-low': Volume1,
    'volume-2': Volume2,
    volume: Volume2,
    heart: Heart,
    'heart-filled': Heart,
    home: Home,
    music: Music,
    'music-2': Music2,
    disc: Disc,
    'disc-3': Disc3,
    user: User,
    users: Users,
    'list-music': ListMusic,
    playlist: ListMusic,
    search: Search,
    queue: List,
    list: List,
    lyrics: Mic2,
    'mic-2': Mic2,
    plugin: Plug,
    connect: Cast,
    cast: Cast,
    'sleep-timer': Moon,
    moon: Moon,
    timer: Timer,
    pin: Pin,
    power: Power,
    sync: RefreshCw,
    refresh: RefreshCw,
    'sync-error': RefreshCw,
    'cloud-off': CloudOff,
    'check-circle': CheckCircle,
    info: Info,
    'alert-triangle': AlertTriangle,
    'alert-circle': AlertCircle,
    check: Check,
    x: X,
    loader: Loader2,
    'chevron-down': ChevronDown,
    'chevron-up': ChevronUp,
    'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight,
    'drag-handle': GripVertical,
    downloaded: Download,
    download: Download,
    upload: Upload,
    fullscreen: Maximize2,
    maximize: Maximize2,
    minimize: Minimize2,
    sparkles: Sparkles,
    speaker: Speaker,
    headphone: Headphones,
    headphones: Headphones,
    settings: Settings,
    folder: Folder,
    trash: Trash2,
    edit: Pencil,
    'external-link': ExternalLink,
    plus: Plus,
    minus: Minus,
    eye: Eye,
    'eye-off': EyeOff,
    globe: Globe,
    gem: Gem,
    keyboard: Keyboard,
    zap: Zap,
    'help-circle': HelpCircle,
    copy: Copy,
    'more-vertical': MoreVertical,
    'more-horizontal': MoreHorizontal,
    shield: Shield,
    radio: Radio,
    flame: Flame,
    compass: Compass,
    library: Library,
    sliders: Sliders,
    'arrow-up-down': ArrowUpDown,
    clock: Clock,
    share: Share2,
    'file-text': FileText,
    monitor: Monitor,
    'bar-chart': BarChart2,
    'bar-chart-2': BarChart2,
    star: Star,
    'arrow-left': ArrowLeft,
    'arrow-right': ArrowRight,
    'arrow-up': ArrowUp,
    'arrow-down': ArrowDown,
    tag: Tag
  };

  $: component = iconMap[name] || HelpCircle;
  $: isFilledHeart = name === 'heart-filled';
  $: isSpin = name === 'loader' || name === 'sync';
</script>

<svelte:component
  this={component}
  size={px}
  {strokeWidth}
  fill={isFilledHeart ? 'currentColor' : 'none'}
  class="{className} {isSpin ? 'icon-spin' : ''}"
  aria-hidden="true"
/>

<style>
  @keyframes icon-spin-anim {
    to {
      transform: rotate(360deg);
    }
  }
  :global(.icon-spin) {
    animation: icon-spin-anim 1s linear infinite;
  }
</style>