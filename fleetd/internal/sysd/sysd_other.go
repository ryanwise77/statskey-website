//go:build !linux

package sysd

import (
	"context"
	"errors"
)

// NewSystemManager is unavailable off Linux; tests use the Fake.
func NewSystemManager(context.Context) (Manager, error) {
	return nil, errors.New("sysd: systemd manager requires Linux")
}
