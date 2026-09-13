import Image from 'next/image'

type BrandMarkProps = {
  className?: string
  size?: number
}

export default function BrandMark({ className, size = 32 }: BrandMarkProps) {
  return (
    <Image
      src="/images/clawdmarket-crab.png"
      alt=""
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      loading="eager"
      draggable={false}
    />
  )
}
