'use client';

import { usePlayerStore } from '@/store/playerStore';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX } from 'lucide-react';

export default function PartMixer() {
  const { parts, partVolumes, partMutes, partSolos, setPartVolume, togglePartMute, togglePartSolo } = usePlayerStore();

  if (!parts || parts.length === 0) return null;

  return (
    <div className="bg-card/85 backdrop-blur-md border border-border/80 rounded-xl p-4 shadow-lg space-y-3 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
          <Volume2 className="h-4 w-4 text-primary" />
          <span>파트별 믹서 (Mixer)</span>
        </h3>
        <span className="text-xs text-muted-foreground">{parts.length}개 트랙</span>
      </div>

      <div className="divide-y divide-border/60 max-h-56 overflow-y-auto pr-1">
        {parts.map((part) => {
          const vol = partVolumes[part.id] ?? 0.8;
          const isMuted = partMutes[part.id] ?? false;
          const isSoloed = partSolos[part.id] ?? false;

          return (
            <div key={part.id} className="py-2.5 flex items-center gap-4 first:pt-0 last:pb-0">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate text-foreground" title={part.name}>
                  {part.name}
                </p>
              </div>

              {/* 볼륨 슬라이더 */}
              <div className="flex items-center gap-2 w-32 sm:w-44">
                <button
                  onClick={() => togglePartMute(part.id)}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title={isMuted ? '음소거 해제' : '음소거'}
                >
                  {isMuted || vol === 0 ? (
                    <VolumeX className="h-4 w-4 text-destructive" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[isMuted ? 0 : vol]}
                  onValueChange={([val]) => {
                    setPartVolume(part.id, val);
                    if (isMuted && val > 0) {
                      togglePartMute(part.id);
                    }
                  }}
                  disabled={isMuted}
                  className="flex-1 animate-pulse-slow"
                />
                <span className="text-[10px] font-mono w-7 text-right text-muted-foreground shrink-0">
                  {Math.round((isMuted ? 0 : vol) * 100)}%
                </span>
              </div>

              {/* Mute / Solo 버튼 */}
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => togglePartMute(part.id)}
                  className={`h-7 px-2.5 text-xs font-semibold rounded-md transition-all ${
                    isMuted 
                      ? 'bg-red-500 hover:bg-red-600 text-white border-red-500' 
                      : 'text-muted-foreground hover:text-red-500 hover:bg-red-50'
                  }`}
                  title="Mute (음소거)"
                >
                  Mute
                </Button>
                <Button
                  size="sm"
                  variant={isSoloed ? 'default' : 'outline'}
                  onClick={() => togglePartSolo(part.id)}
                  className={`h-7 px-2.5 text-xs font-semibold rounded-md transition-all ${
                    isSoloed
                      ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                      : 'text-muted-foreground hover:text-amber-500 hover:bg-amber-50'
                  }`}
                  title="Solo (독주)"
                >
                  Solo
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
