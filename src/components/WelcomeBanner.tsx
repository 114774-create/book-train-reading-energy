import { Card } from "@/components/ui/card";

interface WelcomeBannerProps {
  roleLabel?: string;
  title?: string;
  subtitle?: string;
  emoji?: string;
}

export default function WelcomeBanner({
  roleLabel = "布可列車",
  title = "歡迎回來！一起來借書吧 📚",
  subtitle = "讓閱讀像搭火車一樣開心，今天也加油！",
  emoji = "⭐",
}: WelcomeBannerProps) {
  return (
    <Card className="overflow-hidden">
      <div className="relative p-6 md:p-7 bg-[radial-gradient(circle_at_20%_20%,rgba(251,191,36,0.35),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(34,211,238,0.35),transparent_45%),radial-gradient(circle_at_70%_90%,rgba(167,139,250,0.35),transparent_45%)]">
        <div className="flex items-center justify-between gap-6 flex-wrap">
          <div>
            <div className="text-sm font-extrabold text-muted-foreground">🚂 {roleLabel}</div>
            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">{title}</h2>
            <p className="text-sm text-muted-foreground mt-2">{subtitle}</p>
          </div>
          <div className="shrink-0">
            <div className="h-16 w-16 md:h-20 md:w-20 rounded-3xl bg-white/70 border shadow-[0_18px_45px_-28px_rgba(245,158,11,0.35)] flex items-center justify-center text-4xl">
              {emoji}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
