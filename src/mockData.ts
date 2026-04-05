export interface License {
  licenseNumber: string;
  cnic: string;
  name: string;
  photo: string;
  issueDate: string;
  expiryDate: string;
  status: 'Active' | 'Expired';
}

export const mockLicenses: License[] = [
  {
    licenseNumber: "PL-123456",
    cnic: "35202-1234567-1",
    name: "Ahmad Hassan",
    photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=Ahmad",
    issueDate: "2020-05-15",
    expiryDate: "2025-05-15",
    status: 'Active'
  },
  {
    licenseNumber: "PL-789012",
    cnic: "35202-7654321-2",
    name: "Sara Khan",
    photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sara",
    issueDate: "2018-02-10",
    expiryDate: "2023-02-10",
    status: 'Expired'
  },
  {
    licenseNumber: "PL-555666",
    cnic: "35202-9999999-9",
    name: "Muhammad Ali",
    photo: "https://api.dicebear.com/7.x/avataaars/svg?seed=Ali",
    issueDate: "2022-11-20",
    expiryDate: "2027-11-20",
    status: 'Active'
  }
];
