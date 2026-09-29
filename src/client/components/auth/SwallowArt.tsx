/**
 * 认证页插画「衔枝小院」（ADR-0034，兑现 ADR-0007 预留的柳枝构图）：垂柳 + 一根横枝 + 一只幼燕。
 * 造型（第七轮定稿「幼燕」）：头宽约为躯干长 45%，躯干是胖端在前胸的蛋形、保留颈胸腰起伏、前倾约 24°；
 * 眼径约头宽 26%、位于头高 56% 并偏向喙，主副两个高光；小三角喙 + 嘴角暖黄笑线；
 * 燕子特征交给长刀翅（收起伸到尾叉根）与带白斑的叉尾（左右略错开）。
 * 配色（A 墨青）：背羽低饱和墨青（与翡翠主色为相邻冷色）、额喉陶土红、胸带、暖奶油腹；质感沿用「绒光」
 * （不描边、光影塑形、右上暖色轮廓光、枝上柔影）。颜色只取 token，渐变色标由 auth.css 类名上色，整张 aria-hidden。
 * 动作：引擎分层驱动 眼（pupil + glint 视差）→ 头（head，绕颈转：喙指向目标）→ 脸部组（face）→ 身（body）→ 胸（chest）→ 尾（tail）；
 * 头单独成块、与身共用绝对坐标渐变（无接缝）；目标在背后时根节点 data-facing=back → head-fx 翻转（转身）；
 * 捂眼 = head-fx 翻转（扭头躲开、闭眼），偷看 = 扭头睁眼回瞄。
 * 坐标系：场景 viewBox -12 -70 200 270；幼燕约占 x 53–156、y 47–198，头心 (123, 68)，眼 (130, 70.5)。
 */
import { type Ref, useId } from 'react'

const LEAF = 'M0 0C5-3.4 13-3.4 20 0 13 3.4 5 3.4 0 0Z'
const EYE = { x: 130, y: 70.5, r: 5.4 }

const P = {
  head: 'M123 47.5C135 47.5 144.5 56.5 144.5 68 144.5 79.5 135 88.5 123 88.5 111 88.5 101.5 79.5 101.5 68 101.5 56.5 111 47.5 123 47.5Z',
  body: 'M104 80C110 75 132 75 139 83C146 93 148.5 107 145.5 120C141 138 127 150 109 154C99.5 156 90.5 154 86 149C81 143 80 132 83 120C86 104 94 88 104 80Z',
  belly:
    'M128 88C142 90 150.5 105 148.5 121C144 140 129 153 109 157C102 158 96 156 92.5 151C104 142 114 128 119 114C122 104 124.5 94 128 88Z',
  bellyShade:
    'M92.5 151C104 142 114 128 119 114C116 128 114 141 118 151.5 114 153 110 154 106 154 100 154 95.5 153 92.5 151Z',
  band: 'M117.5 88.5C125 93.5 137 94.5 145.2 91.5C144.5 97 137.5 99.6 129 99.6C122.5 99.6 118 95.8 117.5 88.5Z',
  throat:
    'M143 72C144.5 80 140 87 133 90C127 92 122 90 120 87C125 85 130 82 134 78C137 75 140 73 143 72Z',
  forehead: 'M136.5 51.5C140.5 53.5 143.5 57.5 144 62.5C141 61.5 138 58.5 136 55Z',
  sheen: 'M110 53.5C116 48.5 126 47 133.5 50.5C126 50.2 117.5 51.6 111.6 55.6Z',
  wing: 'M106 88C95 95 88 108 86 123C84 139 78 153 69 169C84 160 95 147 102 132C108 118 112 103 111 94C110.5 90.5 108.5 88 106 88Z',
  covert:
    'M106 88C97 94 91 104 90 115C89 122 93.5 124.5 99.5 120C106 114 111 104 111 95.5C110.8 91.5 108.8 88.5 106 88Z',
  wingTipFar: 'M92 132C86 144 78 156 66 166C78 160 88 150 96 138Z',
  tailFar: 'M92 150C86 162 78 176 66 192C76 184 86 172 96 156Z',
  tail: 'M89 146C82 160 70 178 53 197C66 188 78 177 87 164C84 176 80 187 77 198C86 185 93 170 97 152Z',
  feet: 'M106 152v3.6m-2.2 1.2 2.2-1.2 2.2 1.2M114.5 151v3.6m-2.2 1.2 2.2-1.2 2.2 1.2',
  beakUp: 'M143 64.2L150.8 68.6 143.4 70.4Z',
  beakLo: 'M143.4 70.2L149 70.6 143.4 72.8Z',
  mouth: 'M143.4 70.4L148.6 71.6 143.4 74Z',
  branch:
    'M-40 158C10 155 60 153 110 152 150 151 180 147 240 138 240 142 180 152 150 156 110 158 50 160-40 164Z',
  branchLight: 'M-40 158C10 155 60 153 110 152 150 151 180 147 240 138',
}

/** 一只幼燕用到的渐变（每个 svg 各一套，id 带 uid 防撞）。背羽等用绝对坐标：头与身共用无接缝。 */
function BirdDefs({ uid }: { uid: string }) {
  return (
    <defs>
      <linearGradient
        id={`${uid}-back`}
        gradientUnits="userSpaceOnUse"
        x1="150"
        y1="34"
        x2="80"
        y2="152"
      >
        <stop offset="0" className="xz-stop-back-hi" />
        <stop offset=".1" className="xz-stop-back" />
        <stop offset="1" className="xz-stop-back-lo" />
      </linearGradient>
      <linearGradient
        id={`${uid}-wing`}
        gradientUnits="userSpaceOnUse"
        x1="108"
        y1="92"
        x2="70"
        y2="168"
      >
        <stop offset="0" className="xz-stop-wing-hi" />
        <stop offset=".35" className="xz-stop-back" />
        <stop offset="1" className="xz-stop-wing-lo" />
      </linearGradient>
      <linearGradient
        id={`${uid}-belly`}
        gradientUnits="userSpaceOnUse"
        x1="138"
        y1="96"
        x2="100"
        y2="152"
      >
        <stop offset="0" className="xz-stop-belly" />
        <stop offset=".6" className="xz-stop-belly" />
        <stop offset="1" className="xz-stop-belly-lo" />
      </linearGradient>
      <linearGradient id={`${uid}-throat`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className="xz-stop-throat" />
        <stop offset="1" className="xz-stop-throat-lo" />
      </linearGradient>
      <radialGradient id={`${uid}-eye`} cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" className="xz-stop-eye-hi" />
        <stop offset=".6" className="xz-stop-eye" />
        <stop offset="1" className="xz-stop-eye" />
      </radialGradient>
      <radialGradient id={`${uid}-rim`} gradientUnits="userSpaceOnUse" cx="146" cy="52" r="70">
        <stop offset="0" className="xz-stop-rim" />
        <stop offset="1" className="xz-stop-rim xz-stop-clear" />
      </radialGradient>
      <linearGradient id={`${uid}-bark`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" className="xz-stop-branch" />
        <stop offset="1" className="xz-stop-branch-lo" />
      </linearGradient>
      <radialGradient id={`${uid}-shadow`}>
        <stop offset="0" className="xz-stop-shadow" />
        <stop offset="1" className="xz-stop-shadow xz-stop-clear" />
      </radialGradient>
      {/* 腹、腹影、胸带只画在身体轮廓内 */}
      <clipPath id={`${uid}-torso`}>
        <path d={P.body} />
      </clipPath>
      <radialGradient id={`${uid}-sun`}>
        <stop offset="0" className="xz-stop-sun" />
        <stop offset="1" className="xz-stop-sun xz-stop-clear" />
      </radialGradient>
    </defs>
  )
}

/** 大眼：眨眼缩 lid 组，视线挪 pupil 组；另有眯眼笑 / 闭眼两条弧。 */
function Eye({ uid }: { uid: string }) {
  const { x, y, r } = EYE
  return (
    <g className="xz-bird-eye">
      <g className="xz-bird-eye-open" data-part="lid" style={{ transformOrigin: `${x}px ${y}px` }}>
        <g data-part="pupil">
          <circle cx={x} cy={y} r={r} fill={`url(#${uid}-eye)`} />
          <circle className="xz-bird-iris-ring" cx={x} cy={y} r={r - 0.9} />
          <path
            className="xz-bird-eye-reflect"
            d={`M${x - 3.4} ${y + 2.6}a${r - 1.2} ${r - 1.2} 0 0 0 6.8 0`}
          />
        </g>
        {/* 高光只跟眼珠走 35%（视差），「在看」感更强 */}
        <g data-part="glint">
          <circle className="xz-bird-glint" cx={x + 1.9} cy={y - 2} r="2" />
          <circle className="xz-bird-glint xz-bird-glint-soft" cx={x - 1.8} cy={y + 2.1} r=".85" />
        </g>
      </g>
      <path className="xz-bird-eye-happy" d={`M${x - 5} ${y + 1.5}q5-6 10 0`} />
      <path className="xz-bird-eye-closed" d={`M${x - 5} ${y}q5 4 10 0`} />
    </g>
  )
}

/**
 * 头（引擎的 head，绕颈 (121, 86) 转）：头形、釉光 + 脸部组（引擎的 face）；轮廓光只打在身上，头保持墨青不发灰。
 * head-fx 是 CSS 层：捂眼时绕颈水平翻转（扭头躲开）、出错摇头、啾鸣点头。
 */
function Head({ uid }: { uid: string }) {
  return (
    <g
      className="xz-bird-head"
      data-part="head"
      data-cx="123"
      data-cy="68"
      data-gx="1.8"
      data-gy="1.4"
      data-beak="8"
      data-px="121"
      data-py="86"
    >
      <g className="xz-bird-head-fx" style={{ transformOrigin: '121px 84px' }}>
        <path d={P.head} fill={`url(#${uid}-back)`} />
        <path className="xz-bird-gloss" d={P.sheen} />
        <Face uid={uid} />
      </g>
    </g>
  )
}

/** 脸部组（引擎的 face）：陶土红额喉、腮红、眼、喙与笑线、眉、泪、衔的枝。 */
function Face({ uid }: { uid: string }) {
  const { x, y } = EYE
  return (
    <g className="xz-bird-face" data-part="face">
      <path className="xz-bird-throat" d={P.throat} fill={`url(#${uid}-throat)`} />
      <path className="xz-bird-forehead" d={P.forehead} />
      <ellipse className="xz-bird-blush" cx="127.5" cy="78" rx="3.8" ry="2.2" />
      <g className="xz-bird-blush-lines">
        <path d="M124.6 79.4l1.4-2M127 79.7l1.4-2M129.4 79.8l1.4-2" />
      </g>
      <Eye uid={uid} />
      <g className="xz-bird-brows">
        <path d={`M${x - 5} ${y - 6.5}l7-1.8`} />
      </g>
      <path
        className="xz-bird-tear"
        d={`M${x - 3} ${y + 5}c-1.1 2-1.5 3.1-1.5 3.9a1.5 1.5 0 0 0 3 0c0-.8-.4-1.9-1.5-3.9Z`}
      />
      <g className="xz-bird-beak">
        <path className="xz-bird-mouth" d={P.mouth} />
        <path className="xz-bird-beak-lower" d={P.beakLo} />
        <path className="xz-bird-beak-upper" d={P.beakUp} />
        <path className="xz-bird-beak-shine" d="M144.2 65.6L149.4 68.4" />
        {/* 嘴角：紧贴喙根的一个暖黄小圆角（不再拖一道线到脸上） */}
        <circle className="xz-bird-gape" cx="143.6" cy="71" r="1.05" />
      </g>
      <g className="xz-bird-twig">
        <path className="xz-bird-twig-stem" d="M136 71.5C146 70.5 156 68 168 62" />
        <path
          className="xz-bird-leaf"
          d={LEAF}
          transform="translate(160 65) rotate(-38) scale(.45)"
        />
        <path
          className="xz-bird-leaf-2"
          d={LEAF}
          transform="translate(166 62.5) rotate(16) scale(.4)"
        />
      </g>
    </g>
  )
}

/** 特效符号（? ! ♪ zZ 心 星 汗）：默认隐藏，按情绪 / 小动作显示。 */
function Fx() {
  return (
    <g className="xz-bird-fx">
      <text className="xz-fx xz-fx-q" x="148" y="46">
        ?
      </text>
      <text className="xz-fx xz-fx-bang" x="149" y="46">
        !
      </text>
      <text className="xz-fx xz-fx-note" x="152" y="52">
        ♪
      </text>
      <g className="xz-fx xz-fx-z">
        <text x="144" y="48">
          z
        </text>
        <text x="153" y="37">
          Z
        </text>
      </g>
      <path
        className="xz-fx xz-fx-sweat"
        d="M149 50c-1.6 2.8-2.2 4.4-2.2 5.6a2.2 2.2 0 0 0 4.4 0c0-1.2-.6-2.8-2.2-5.6Z"
      />
      <g className="xz-fx xz-fx-hearts">
        <path d="M154 40c-1.6-2.8-6-1.6-4.9 1.6.6 1.6 2.8 3.3 4.9 4.9 2.1-1.6 4.3-3.3 4.9-4.9 1.1-3.2-3.3-4.4-4.9-1.6Z" />
        <path d="M100 52c-1.1-1.9-4-1.1-3.4 1.1.4 1.1 1.9 2.2 3.4 3.2 1.5-1 3-2.1 3.4-3.2.6-2.2-2.3-3-3.4-1.1Z" />
      </g>
      <g className="xz-fx xz-fx-spark">
        <path d="M158 36l1.3 3.2 3.2 1.3-3.2 1.3-1.3 3.2-1.3-3.2-3.2-1.3 3.2-1.3Z" />
        <path d="M98 42l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1Z" />
        <path d="M160 78l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z" />
      </g>
    </g>
  )
}

function Willow({
  d,
  leaves,
  delay,
}: {
  d: string
  leaves: [number, number, number][]
  delay: number
}) {
  const [x0, y0] = d.slice(1).split(/[ C]/).map(Number)
  return (
    <g
      className="xz-willow"
      style={{ transformOrigin: `${x0}px ${y0}px`, animationDelay: `${delay}s` }}
    >
      <path className="xz-willow-strand" d={d} />
      {leaves.map(([x, y, r], i) => (
        <path
          key={`${x}-${y}`}
          className={r % 2 ? 'xz-willow-leaf' : 'xz-willow-leaf-2'}
          d={LEAF}
          transform={`translate(${x} ${y}) rotate(${r}) scale(${0.36 + (i % 3) * 0.05})`}
        />
      ))}
    </g>
  )
}

/** 一根垂柳：从画面上方垂到 y1，叶子沿枝交替两侧、大小错落。 */
const strand = (
  x: number,
  y0: number,
  y1: number,
  sway: number,
): [string, [number, number, number][]] => {
  const d = `M${x} ${y0}C${x - sway} ${y0 + (y1 - y0) * 0.4} ${x - sway} ${y0 + (y1 - y0) * 0.75} ${x} ${y1}`
  const leaves: [number, number, number][] = []
  for (let y = y0 + 40, i = 0; y < y1 - 4; y += 20, i++) {
    const t = (y - y0) / (y1 - y0)
    leaves.push([Math.round((x - sway * 1.5 * t * (1 - t) * 2) * 10) / 10, y, i % 2 ? 101 : 79])
  }
  return [d, leaves]
}
const W1 = strand(-2, -260, 20, 4)
const W2 = strand(20, -260, -24, 3)
const W3 = strand(176, -260, -34, -4)

/** 幼燕身体（场景与探头版共用）：叉尾（白斑）、远侧翅尖、蛋形身 + 轮廓光、腹、胸带、脚。 */
function Body({ uid, peek = false }: { uid: string; peek?: boolean }) {
  return (
    <>
      {peek ? null : (
        <g className="xz-bird-tail" data-part="tail" style={{ transformOrigin: '89px 148px' }}>
          <path className="xz-bird-wing-far" d={P.tailFar} />
          <path d={P.tail} fill={`url(#${uid}-wing)`} />
          <ellipse
            className="xz-bird-tail-spot"
            cx="80"
            cy="172"
            rx="1.6"
            ry="3"
            transform="rotate(38 80 172)"
          />
          <ellipse
            className="xz-bird-tail-spot"
            cx="72"
            cy="183"
            rx="1.4"
            ry="2.6"
            transform="rotate(38 72 183)"
          />
        </g>
      )}
      {peek ? null : <path className="xz-bird-wing-far" d={P.wingTipFar} />}
      <path d={P.body} fill={`url(#${uid}-back)`} />
      <path d={P.body} fill={`url(#${uid}-rim)`} />
      <g clipPath={`url(#${uid}-torso)`}>
        <g data-part="chest" style={{ transformOrigin: '128px 122px' }}>
          <path d={P.belly} fill={`url(#${uid}-belly)`} />
          <path className="xz-bird-belly-shade" d={P.bellyShade} />
          <path className="xz-bird-band" d={P.band} />
        </g>
      </g>
      {peek ? null : <path className="xz-bird-feet" d={P.feet} />}
    </>
  )
}

/** 近侧长刀翅：收起时伸到尾叉根，上覆一片覆羽。 */
function NearWing({ uid }: { uid: string }) {
  return (
    <g className="xz-bird-wing xz-bird-wing-l" style={{ transformOrigin: '106px 90px' }}>
      {/* 翅下柔影：翅膀压在身上的体积感 */}
      <path className="xz-bird-wing-shadow" d={P.wing} transform="translate(2.2 2.6)" />
      <path d={P.wing} fill={`url(#${uid}-wing)`} />
      <path className="xz-bird-covert" d={P.covert} />
      <path className="xz-bird-wing-shine" d="M96 116q5 1 9-5M92 130q4 1 7-4" />
    </g>
  )
}

/** 完整场景（≥ 900px 左栏）。 */
export function SwallowScene({ onPoke, ref }: { onPoke?: () => void; ref?: Ref<SVGSVGElement> }) {
  const uid = useId().replace(/:/g, '')
  return (
    <svg
      ref={ref}
      viewBox="-12 -70 200 270"
      className="xz-bird-svg"
      aria-hidden
      role="presentation"
    >
      <BirdDefs uid={uid} />
      <circle cx="152" cy="-26" r="76" fill={`url(#${uid}-sun)`} />
      <circle className="xz-scene-orb" cx="152" cy="-26" r="20" />

      <Willow d={W1[0]} leaves={W1[1]} delay={0} />
      <Willow d={W2[0]} leaves={W2[1]} delay={-1.6} />
      <Willow d={W3[0]} leaves={W3[1]} delay={-0.8} />

      <g className="xz-falling" aria-hidden>
        <path className="xz-willow-leaf" d={LEAF} transform="translate(40 -66) scale(.45)" />
        <path className="xz-willow-leaf-2" d={LEAF} transform="translate(100 -70) scale(.45)" />
        <path className="xz-willow-leaf" d={LEAF} transform="translate(150 -60) scale(.45)" />
      </g>

      {/* 横枝：锥形 + 树皮渐变 + 一道受光边；两端小枝几片叶 */}
      <path d={P.branch} fill={`url(#${uid}-bark)`} />
      <path className="xz-branch-light" d={P.branchLight} />
      <path className="xz-branch-twig" d="M10 156C13 163 14 170 13 177" />
      <path className="xz-branch-twig" d="M164 149C168 142 174 138 182 136" />
      <path
        className="xz-willow-leaf"
        d={LEAF}
        transform="translate(13 176) rotate(96) scale(.42)"
      />
      <path
        className="xz-willow-leaf-2"
        d={LEAF}
        transform="translate(12 166) rotate(150) scale(.36)"
      />
      <path
        className="xz-willow-leaf-2"
        d={LEAF}
        transform="translate(182 136) rotate(-20) scale(.44)"
      />
      <path
        className="xz-willow-leaf"
        d={LEAF}
        transform="translate(176 140) rotate(-80) scale(.36)"
      />
      {/* 落在枝上的柔影（不随跳跃移动） */}
      <ellipse
        className="xz-bird-shadow"
        cx="108"
        cy="155"
        rx="22"
        ry="3.2"
        fill={`url(#${uid}-shadow)`}
      />

      {/* 幼燕 */}
      <g className="xz-bird" data-part="bird">
        <g className="xz-bird-hop" style={{ transformOrigin: '110px 154px' }}>
          <g className="xz-bird-body" data-part="body" style={{ transformOrigin: '110px 152px' }}>
            <Body uid={uid} />
            <NearWing uid={uid} />
            <Head uid={uid} />
          </g>
          <Fx />
          {/* 点击热区（仅指针彩蛋，不可聚焦；整张 aria-hidden） */}
          <ellipse
            className="xz-bird-hit"
            cx="116"
            cy="104"
            rx="36"
            ry="54"
            onPointerDown={onPoke}
          />
        </g>
      </g>
    </svg>
  )
}

/** 探头版（< 900px）：卡片顶沿探出的头胸；捂眼同样扭头躲开。视窗对准头部坐标。 */
export function SwallowPeek({ onPoke, ref }: { onPoke?: () => void; ref?: Ref<SVGSVGElement> }) {
  const uid = useId().replace(/:/g, '')
  return (
    <svg ref={ref} viewBox="86 38 76 64" className="xz-bird-svg" aria-hidden role="presentation">
      <BirdDefs uid={uid} />
      <g className="xz-bird" data-part="bird">
        <g className="xz-bird-hop" style={{ transformOrigin: '122px 102px' }}>
          <g className="xz-bird-body" data-part="body" style={{ transformOrigin: '122px 102px' }}>
            <Body uid={uid} peek />
            <NearWing uid={uid} />
            <Head uid={uid} />
          </g>
          <Fx />
          <ellipse
            className="xz-bird-hit"
            cx="124"
            cy="72"
            rx="30"
            ry="30"
            onPointerDown={onPoke}
          />
        </g>
      </g>
    </svg>
  )
}
