import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Card } from "@daifugo/core";
import { CardFan } from "../src/components/CardFan";
import { CopyProvider } from "../src/i18n/index";
import { CARD_WIDTH, layoutHand } from "../src/layout/handLayout";

afterEach(() => vi.unstubAllGlobals());

it("fits the safe content width, preserves spacing on selection, and restores it after resize", () => {
  type ResizeCallback = (entries: ResizeObserverEntry[]) => void;
  let resize!: ResizeCallback;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeCallback) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const cards: Card[] = Array.from({ length: 18 }, (_, index) => ({
    id: `card-${index}`,
    suit: "S",
    rank: 3,
    isJoker: false,
  }));
  const layout = layoutHand(cards.map(() => 1));
  const view = (selected: boolean) => (
    <CopyProvider>
      <div className="hand">
        <CardFan cards={cards} layout={layout} isSelected={() => selected} />
      </div>
    </CopyProvider>
  );
  const { container, rerender, unmount } = render(view(false));
  expect(observe).toHaveBeenCalledWith(container.querySelector(".hand"));
  const reportWidth = (width: number) =>
    act(() => resize([{ contentRect: { width } } as ResizeObserverEntry]));
  reportWidth(700);
  const fan = container.querySelector<HTMLElement>(".hand__fan")!;
  const last = container.querySelector<HTMLElement>(".hand__slot:last-child")!;
  expect(Number.parseFloat(fan.style.width)).toBeCloseTo(668);
  expect(Number.parseFloat(last.style.left) + CARD_WIDTH).toBeCloseTo(668);
  const spacing = last.style.left;
  rerender(view(true));
  expect(last.style.left).toBe(spacing);
  reportWidth(844);
  expect(Number.parseFloat(fan.style.width)).toBeCloseTo(layout.width);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
