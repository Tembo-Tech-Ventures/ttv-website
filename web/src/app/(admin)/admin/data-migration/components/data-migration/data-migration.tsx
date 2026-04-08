"use client";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useState } from "react";

interface DataMigrationProps {
  counts: {
    users: number;
    curricula: number;
    programs: number;
    programRoles: number;
    programPartners: number;
    programApplications: number;
    roles: number;
    userRoles: number;
    blogPosts: number;
    files: number;
  };
}

const TABLE_LABELS: Record<string, string> = {
  users: "Users",
  curricula: "Curricula",
  programs: "Programs",
  programRoles: "Program Roles",
  programPartners: "Program Partners",
  programApplications: "Program Applications",
  roles: "Roles",
  userRoles: "User Roles",
  blogPosts: "Blog Posts",
  files: "Files",
};

type ExportStatus = "idle" | "loading" | "success" | "error";

interface ImportPreview {
  exportedAt: string;
  version: number;
  counts: Record<string, number>;
}

export default function DataMigration({ counts }: DataMigrationProps) {
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const [importFile, setImportFile] = useState<File | null>(null);

  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);

  const handleExport = async () => {
    setExportStatus("loading");
    setExportError(null);
    try {
      const res = await fetch("/api/admin/export");
      if (!res.ok) {
        throw new Error(`Export failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ttv-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportStatus("success");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
      setExportStatus("error");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportPreview(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (!data.version || !data.exportedAt) {
          throw new Error("Invalid export file: missing version or exportedAt");
        }
        const previewCounts: Record<string, number> = {};
        for (const key of Object.keys(TABLE_LABELS)) {
          if (Array.isArray(data[key])) {
            previewCounts[key] = data[key].length;
          }
        }
        setImportPreview({
          exportedAt: data.exportedAt,
          version: data.version,
          counts: previewCounts,
        });
      } catch (err) {
        setImportPreview(null);
        setImportFile(null);
        alert(
          err instanceof Error ? err.message : "Failed to parse export file",
        );
      }
    };
    reader.readAsText(file);
  };

  return (
    <Stack spacing={3}>
      {/* Export Section */}
      <Card sx={{ bgcolor: "rgba(255,255,255,0.05)" }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="h6" color="white">
                Export Data
              </Typography>
              <Chip
                label={`${totalRecords} total records`}
                color="primary"
                size="small"
              />
            </Stack>
            <Typography variant="body2" color="grey.400">
              Export all database records as JSON for migration to the
              Cloudflare deployment. The export includes users, programs,
              applications, roles, and all related data.
            </Typography>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell
                      sx={{ color: "grey.400", borderColor: "grey.800" }}
                    >
                      Table
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ color: "grey.400", borderColor: "grey.800" }}
                    >
                      Records
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(counts).map(([key, count]) => (
                    <TableRow key={key}>
                      <TableCell
                        sx={{ color: "white", borderColor: "grey.800" }}
                      >
                        {TABLE_LABELS[key] || key}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: "white", borderColor: "grey.800" }}
                      >
                        {count}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Box>
              <Button
                variant="contained"
                onClick={handleExport}
                disabled={exportStatus === "loading"}
                startIcon={
                  exportStatus === "loading" ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : null
                }
              >
                {exportStatus === "loading"
                  ? "Exporting..."
                  : "Download Export JSON"}
              </Button>
            </Box>

            {exportStatus === "success" && (
              <Alert severity="success">
                Export downloaded successfully. Use this file to import data
                into the Cloudflare deployment.
              </Alert>
            )}
            {exportStatus === "error" && exportError && (
              <Alert severity="error">{exportError}</Alert>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Import Preview Section */}
      <Card sx={{ bgcolor: "rgba(255,255,255,0.05)" }}>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6" color="white">
              Validate Export File
            </Typography>
            <Typography variant="body2" color="grey.400">
              Upload a previously exported JSON file to validate its contents
              and preview record counts before importing on the Cloudflare side.
            </Typography>

            <Box>
              <Button variant="outlined" component="label">
                Select Export File
                <input
                  type="file"
                  hidden
                  accept=".json"
                  onChange={handleFileSelect}
                />
              </Button>
              {importFile && (
                <Typography variant="body2" color="grey.400" sx={{ mt: 1 }}>
                  Selected: {importFile.name} (
                  {(importFile.size / 1024).toFixed(1)} KB)
                </Typography>
              )}
            </Box>

            {importPreview && (
              <>
                <Divider sx={{ borderColor: "grey.800" }} />
                <Stack direction="row" spacing={2}>
                  <Chip
                    label={`Version ${importPreview.version}`}
                    size="small"
                    color="info"
                  />
                  <Chip
                    label={`Exported: ${new Date(importPreview.exportedAt).toLocaleString()}`}
                    size="small"
                    variant="outlined"
                  />
                </Stack>

                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell
                          sx={{ color: "grey.400", borderColor: "grey.800" }}
                        >
                          Table
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ color: "grey.400", borderColor: "grey.800" }}
                        >
                          In File
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ color: "grey.400", borderColor: "grey.800" }}
                        >
                          In Database
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ color: "grey.400", borderColor: "grey.800" }}
                        >
                          Diff
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.entries(importPreview.counts).map(
                        ([key, count]) => {
                          const dbCount =
                            counts[key as keyof typeof counts] ?? 0;
                          const diff = count - dbCount;
                          return (
                            <TableRow key={key}>
                              <TableCell
                                sx={{
                                  color: "white",
                                  borderColor: "grey.800",
                                }}
                              >
                                {TABLE_LABELS[key] || key}
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{
                                  color: "white",
                                  borderColor: "grey.800",
                                }}
                              >
                                {count}
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{
                                  color: "white",
                                  borderColor: "grey.800",
                                }}
                              >
                                {dbCount}
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{
                                  color:
                                    diff === 0
                                      ? "grey.400"
                                      : diff > 0
                                        ? "warning.main"
                                        : "error.main",
                                  borderColor: "grey.800",
                                }}
                              >
                                {diff === 0
                                  ? "—"
                                  : diff > 0
                                    ? `+${diff}`
                                    : diff}
                              </TableCell>
                            </TableRow>
                          );
                        },
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>

                <Alert severity="info">
                  This file looks valid. To import into the Cloudflare
                  deployment, use the import tool on the new site&apos;s admin
                  panel, or run:{" "}
                  <code>
                    node scripts/import-data.mjs export.json &gt; import.sql
                  </code>
                </Alert>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Migration Guide */}
      <Card sx={{ bgcolor: "rgba(255,255,255,0.05)" }}>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6" color="white">
              Migration Steps
            </Typography>
            <Typography variant="body2" color="grey.300" component="div">
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li>
                  <strong>Export</strong> — Download the JSON export from this
                  page using the button above.
                </li>
                <li>
                  <strong>Validate</strong> — Use the validator above to confirm
                  the export file contains the expected data.
                </li>
                <li>
                  <strong>Import</strong> — On the Cloudflare deployment, go to
                  Admin &rarr; Data Migration and upload the JSON file, or use
                  the CLI:{" "}
                  <code>
                    node scripts/import-data.mjs export.json &gt; import.sql
                  </code>
                </li>
                <li>
                  <strong>Verify</strong> — Check that all records are present
                  in the new deployment and that certificates, applications, and
                  user data are intact.
                </li>
              </ol>
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
