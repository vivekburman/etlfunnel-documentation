# User Libraries

User Libraries allow you to create reusable helper functions, utility operations, and global constants that can be shared across your ETL pipelines. This promotes code reusability and maintains consistency in your data processing workflows.

## Overview

User Libraries serve as a centralized repository for:
- **Helper Functions**: Custom utility functions for data transformations
- **Global Constants**: Shared configuration values and parameters
- **Reusable Operations**: Complete operations like file I/O handlers, API clients.


## Creating User Libraries

### Example: Constants Library

```go
package client_userlibrary

import "time"

// API configuration
const (
    APIMaxRetries    = 3
    APITimeout       = 30 * time.Second
    APIRateLimit     = 100 // requests per minute
)
```

### Example: Utility Functions

```go
package client_userlibrary

import (
    "encoding/json"
    "fmt"
    "strings"
)

// DataValidator provides common validation utilities
type DataValidator struct{}

// ValidateEmail checks if email format is valid
func (dv *DataValidator) ValidateEmail(email string) bool {
    return strings.Contains(email, "@") && strings.Contains(email, ".")
}

// FormatPhoneNumber standardizes phone number format
func (dv *DataValidator) FormatPhoneNumber(phone string) string {
    // Remove non-numeric characters
    cleaned := strings.ReplaceAll(phone, "-", "")
    cleaned = strings.ReplaceAll(cleaned, " ", "")
    cleaned = strings.ReplaceAll(cleaned, "(", "")
    cleaned = strings.ReplaceAll(cleaned, ")", "")
    return cleaned
}

// JSONHelper provides JSON manipulation utilities
func MarshalWithIndent(data interface{}) (string, error) {
    bytes, err := json.MarshalIndent(data, "", "  ")
    if err != nil {
        return "", fmt.Errorf("failed to marshal JSON: %w", err)
    }
    return string(bytes), nil
}
```

### Example: API Handler

```go
package client_userlibrary

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
    "time"
)

// APIClient handles common API operations
type APIClient struct {
    BaseURL string
    Timeout time.Duration
    Headers map[string]string
}

// NewAPIClient creates a new API client instance
func NewAPIClient(baseURL string) *APIClient {
    return &APIClient{
        BaseURL: baseURL,
        Timeout: APITimeout,
        Headers: make(map[string]string),
    }
}

// SetHeader adds a header to all requests
func (c *APIClient) SetHeader(key, value string) {
    c.Headers[key] = value
}

// POST sends a POST request with JSON payload
func (c *APIClient) POST(endpoint string, payload interface{}) (*http.Response, error) {
    jsonData, err := json.Marshal(payload)
    if err != nil {
        return nil, fmt.Errorf("failed to marshal payload: %w", err)
    }

    client := &http.Client{Timeout: c.Timeout}
    req, err := http.NewRequest("POST", c.BaseURL+endpoint, bytes.NewBuffer(jsonData))
    if err != nil {
        return nil, fmt.Errorf("failed to create request: %w", err)
    }

    // Set headers
    req.Header.Set("Content-Type", "application/json")
    for key, value := range c.Headers {
        req.Header.Set(key, value)
    }

    return client.Do(req)
}
```

## Using Libraries in Pipelines

Once created, your User Libraries can be imported and used in any pipeline:

```go
// Import your user library
import "your-workspace/client_userlibrary"

// Use utility functions
validator := &client_userlibrary.DataValidator{}
isValid := validator.ValidateEmail("user@example.com")

// Use API client
apiClient := client_userlibrary.NewAPIClient("https://api.example.com")
apiClient.SetHeader("Authorization", "Bearer your-token")
response, err := apiClient.POST("/users", userData)
```

## Best Practices

:::tip Best Practices
- **Descriptive Naming**: Use clear, descriptive names for functions and constants
- **Documentation**: Add comments explaining function purposes and parameters
- **Error Handling**: Include proper error handling in utility functions
- **Versioning**: Consider versioning for breaking changes to maintain pipeline compatibility
- **Testing**: Test your utilities thoroughly before using in production pipelines
:::

:::warning Important Notes
- Changes to User Libraries affect all dependent pipelines
- Test library changes in development environments first
- Consider backward compatibility when updating existing functions
:::

## Common Use Cases

| Use Case | Description | Example |
|----------|-------------|---------|
| **Configuration Management** | Centralized constants and settings | Database timeouts, batch sizes, API endpoints |
| **Data Validation** | Reusable validation logic | Email format, phone numbers, data quality checks |
| **API Integration** | Standardized API client patterns | REST clients, authentication handlers |
| **File Operations** | Common file I/O patterns | CSV readers, JSON parsers, file validators |
| **Data Transformations** | Shared transformation logic | Date formatting, string cleaning, data normalization |