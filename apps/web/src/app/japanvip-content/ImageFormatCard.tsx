"use client";

/**
 * Bảng khổ ảnh dùng chung + ánh xạ vai trò.
 *
 * Mô hình cố ý KHÔNG cho mỗi vai trò một bộ tỉ lệ riêng: tám vai trò × sáu
 * trường là ~48 ô để điền và để bảo trì, trong khi feature với detail gần như
 * luôn cùng một khổ. Ở đây khai báo vài khổ dùng chung rồi mỗi vai trò chỉ chọn
 * khổ nào chấp nhận được và bố cục nào.
 */

import { RotateCcw, Save, Shapes } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorBanner } from "@/components/ErrorBanner";
import { Panel } from "@/components/Panel";
import {
  getJapanVipImageFormat,
  resetJapanVipImageFormat,
  saveJapanVipImageFormat,
  type JapanVipImageFormatConfig,
  type JapanVipImageLayout,
  type JapanVipRoleFormat,
} from "@/lib/api";

const ROLE_LABEL: Record<JapanVipRoleFormat["role"], string> = {
  hero: "Hero",
  "main-packshot": "Ảnh sản phẩm chính",
  "alternate-angle": "Góc khác",
  feature: "Feature lớn",
  "feature-small": "Feature nhỏ",
  detail: "Chi tiết",
  dimensions: "Kích thước",
  maintenance: "Vệ sinh",
};

const LAYOUT_LABEL: Record<JapanVipImageLayout, string> = {
  full: "Tràn khổ",
  solo: "Một ảnh",
  "grid-2": "Lưới 2",
  "grid-3": "Lưới 3",
};

/** 1.7778 đọc không ra gì; 16:9 thì đọc phát hiểu ngay. */
function ratioLabel(value: number | null): string {
  if (value === null) return "giữ tỷ lệ gốc";
  const known: Array<[number, string]> = [[16 / 9, "16:9"], [4 / 3, "4:3"], [1, "1:1"], [3 / 4, "3:4"], [3 / 2, "3:2"]];
  const hit = known.find(([ratio]) => Math.abs(ratio - value) < 0.01);
  return hit ? hit[1] : value.toFixed(2);
}

export function ImageFormatCard() {
  const [config, setConfig] = useState<JapanVipImageFormatConfig | null>(null);
  const [saved, setSaved] = useState<JapanVipImageFormatConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const next = await getJapanVipImageFormat();
        setConfig(next);
        setSaved(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const dirty = Boolean(config && saved && JSON.stringify(config) !== JSON.stringify(saved));

  async function run(label: string, action: () => Promise<JapanVipImageFormatConfig>) {
    setBusy(label);
    setError(null);
    try {
      const next = await action();
      setConfig(next);
      setSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function patchPreset(id: string, patch: Partial<JapanVipImageFormatConfig["presets"][number]>) {
    setConfig((current) => current ? { ...current, presets: current.presets.map((preset) => preset.id === id ? { ...preset, ...patch } : preset) } : current);
  }

  function patchRole(role: JapanVipRoleFormat["role"], patch: Partial<JapanVipRoleFormat>) {
    setConfig((current) => current ? { ...current, roles: current.roles.map((item) => item.role === role ? { ...item, ...patch } : item) } : current);
  }

  if (!config) {
    return <Card title="Khổ ảnh trong bài viết">{error ? <ErrorBanner message="Không tải được cấu hình khổ ảnh" detail={error} /> : <p className="py-5 text-center text-sm text-[var(--text-muted)]">Đang tải…</p>}</Card>;
  }

  return (
    <Card
      title="Khổ ảnh trong bài viết"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <Badge tone="running" label="Chưa lưu" />}
          <Button small variant="secondary" disabled={busy !== null} onClick={() => void run("reset", resetJapanVipImageFormat)}>
            <RotateCcw size={14} /> Khôi phục mặc định
          </Button>
          <Button small disabled={!dirty || busy !== null} onClick={() => void run("save", () => saveJapanVipImageFormat(config))}>
            <Save size={14} /> {busy === "save" ? "Đang lưu…" : "Lưu khổ ảnh"}
          </Button>
        </div>
      }
    >
      {error && <div className="mb-3"><ErrorBanner message="Thao tác chưa hoàn tất" detail={error} /></div>}
      <p className="mb-3 text-sm text-[var(--text-muted)]">
        Khai báo vài khổ dùng chung rồi gán từng vai trò ảnh vào khổ. Khổ được áp lúc xuất bản và cũng là điều kiện để ảnh hãng được tự duyệt — ảnh lệch khổ vẫn giữ lại nhưng luôn chờ bạn xem.
      </p>

      <Panel title="Khổ dùng chung">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Khổ</th><th>Tỷ lệ</th><th>Dung sai</th><th>Kích thước nguồn tối thiểu</th><th>Cách hiển thị</th></tr>
            </thead>
            <tbody>
              {config.presets.map((preset) => (
                <tr key={preset.id}>
                  <td><span className="font-medium">{preset.label}</span><span className="mt-1 block text-meta text-[var(--text-muted)]">{preset.id}</span></td>
                  <td className="whitespace-nowrap">{ratioLabel(preset.aspectRatio)}</td>
                  <td>
                    <input
                      className="input w-20" type="number" min={0} max={100} step={1}
                      aria-label={`Dung sai khổ ${preset.label}`}
                      value={Math.round(preset.tolerance * 100)}
                      onChange={(e) => patchPreset(preset.id, { tolerance: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })}
                    />
                    <span className="ml-1 text-meta text-[var(--text-muted)]">%</span>
                  </td>
                  <td>
                    <span className="flex items-center gap-1">
                      <input className="input w-24" type="number" min={0} step={50} aria-label={`Rộng tối thiểu ${preset.label}`} value={preset.minWidth} onChange={(e) => patchPreset(preset.id, { minWidth: Math.max(0, Number(e.target.value) || 0) })} />
                      <span className="text-meta text-[var(--text-muted)]">×</span>
                      <input className="input w-24" type="number" min={0} step={50} aria-label={`Cao tối thiểu ${preset.label}`} value={preset.minHeight} onChange={(e) => patchPreset(preset.id, { minHeight: Math.max(0, Number(e.target.value) || 0) })} />
                    </span>
                  </td>
                  <td>
                    {preset.aspectRatio === null ? (
                      <span className="text-meta text-[var(--text-muted)]">Không cắt (khóa cứng)</span>
                    ) : (
                      <select className="input" aria-label={`Cách hiển thị ${preset.label}`} value={preset.fit} onChange={(e) => patchPreset(preset.id, { fit: e.target.value as "contain" | "cover" })}>
                        <option value="contain">Không cắt, chừa viền</option>
                        <option value="cover">Cắt cho đầy khung</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Vai trò ảnh dùng khổ nào" className="mt-3">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Vai trò</th><th>Khổ chấp nhận được</th><th>Bố cục</th></tr>
            </thead>
            <tbody>
              {config.roles.map((role) => (
                <tr key={role.role}>
                  <td className="font-medium">{ROLE_LABEL[role.role]}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      {config.presets.map((preset) => {
                        const checked = role.accept.includes(preset.id);
                        return (
                          <label key={preset.id} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${checked ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_12%,var(--surface))] text-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
                            <input
                              className="sr-only" type="checkbox" checked={checked}
                              onChange={(e) => patchRole(role.role, {
                                // Bỏ hết khổ thì vai trò trỏ vào hư không -> luôn chừa lại ít nhất một.
                                accept: e.target.checked
                                  ? [...role.accept, preset.id]
                                  : role.accept.length > 1 ? role.accept.filter((id) => id !== preset.id) : role.accept,
                              })}
                            />
                            {preset.label}
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-meta text-[var(--text-muted)]">Ưu tiên: {config.presets.find((preset) => preset.id === role.accept[0])?.label ?? "—"}</p>
                  </td>
                  <td>
                    <select className="input" aria-label={`Bố cục ${ROLE_LABEL[role.role]}`} value={role.layout} onChange={(e) => patchRole(role.role, { layout: e.target.value as JapanVipImageLayout })}>
                      {(Object.entries(LAYOUT_LABEL) as Array<[JapanVipImageLayout, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--text-muted)]">
        <Shapes size={14} className="mt-0.5 shrink-0 text-[var(--primary)]" />
        <span>Luật không tắt được: ảnh dọc không bao giờ tràn khổ; sơ đồ và bản vẽ kích thước không bao giờ bị cắt; ảnh nguồn nhỏ không bị phóng to; bản PC/mobile trùng nhau chỉ lấy một. Lưới tự rút về một ảnh lớn khi phần đó chỉ có một ảnh.</span>
      </p>
    </Card>
  );
}
