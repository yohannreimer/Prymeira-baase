import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MonitoringErrorBoundary,
  MonitoringFallback
} from "./MonitoringErrorBoundary";

function BrokenScreen(): never {
  throw new Error("unexpected render failure");
}

describe("MonitoringErrorBoundary", () => {
  it("keeps unexpected render failures inside a useful fallback", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <MonitoringErrorBoundary>
        <BrokenScreen />
      </MonitoringErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível exibir esta tela.");
    expect(screen.getByText(/Recarregue a página/)).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("offers a reload action without exposing error details", () => {
    const onReload = vi.fn();

    render(<MonitoringFallback onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar página" }));

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/unexpected render failure/i)).not.toBeInTheDocument();
  });
});
