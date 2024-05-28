import { Button, FormLabel, MenuItem, Select } from "@mui/material";
import { ApplicationStatus } from "@prisma/client";

interface StatusProps {
  value?: string;
}

export async function Status({ value }: StatusProps) {
  const options = Object.values(ApplicationStatus);

  async function updateStatus(formData: FormData) {
    "use server";
    const status = formData.get("status") as string;
  }
  return (
    <form action={updateStatus}>
      <FormLabel>
        <Select size="small" value={value || ""} name="status" id="status">
          <MenuItem value="">Status</MenuItem>
          {options?.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </Select>
      </FormLabel>
      <Button type="submit" variant="text">
        {" "}
        Update{" "}
      </Button>
    </form>
  );
}
