import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadModuleExcel } from "@/lib/api";
import { getLatestAnalysisId } from "@/lib/analysis-report-store";
import { useExcelPeriodParams } from "@/contexts/PeriodContext";

export function ModuleExcelButton({
  module,
  label = "Download Excel",
  size = "sm",
  className = "",
  variant = "default",
  params,
}: {
  module: string;
  label?: string;
  size?: "sm" | "default" | "lg";
  className?: string;
  variant?: "default" | "outline" | "secondary";
  params?: Record<string, string | number | boolean | undefined>;
}) {
  const [downloading, setDownloading] = useState(false);
  const periodParams = useExcelPeriodParams();

  const handleDownload = async () => {
    const analysisId = getLatestAnalysisId();
    if (!analysisId) {
      alert("No analysis report found. Please upload and analyze a bank statement first.");
      return;
    }

    try {
      setDownloading(true);
      await downloadModuleExcel(analysisId, module, { ...periodParams, ...params });
    } catch (error) {
      console.error("Failed to download Excel:", error);
      alert("Failed to download Excel file. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handleDownload}
      className={`no-print gap-2 ${className}`.trim()}
      disabled={downloading}
    >
      <Download className="h-4 w-4" />
      {downloading ? "Downloading..." : label}
    </Button>
  );
}
