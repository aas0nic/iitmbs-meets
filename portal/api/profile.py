"""The signed-in member's own settings: saved payout details for reimbursements."""
from flask import Blueprint, jsonify, request

from ..auth import current_user, login_required
from ..db import get_db, one, utcnow
from .common import PROPOSER_ROLES, parse_bank

bp = Blueprint('profile', __name__, url_prefix='/api/me')


def load_payout(user_id):
    return one(get_db().execute('SELECT account_holder, bank_name, account_number, ifsc, upi_id, updated_at '
                                'FROM payout_details WHERE user_id = ?', (user_id,)).fetchone())


def save_payout_details(user_id, bank):
    """Upsert saved details from a parse_bank() dict (also used when a claim pays the claimant)."""
    get_db().execute('''INSERT INTO payout_details (user_id, account_holder, bank_name, account_number, ifsc, upi_id, updated_at)
                        VALUES (?,?,?,?,?,?,?)
                        ON CONFLICT(user_id) DO UPDATE SET account_holder = excluded.account_holder,
                            bank_name = excluded.bank_name, account_number = excluded.account_number,
                            ifsc = excluded.ifsc, upi_id = excluded.upi_id, updated_at = excluded.updated_at''',
                     (user_id, bank['payee_name'], bank['bank_name'], bank['account_number'], bank['ifsc'],
                      bank['upi_id'], utcnow()))


@bp.get('/payout')
@login_required(*PROPOSER_ROLES)
def get_payout():
    return jsonify(payout=load_payout(current_user()['id']))


@bp.put('/payout')
@login_required(*PROPOSER_ROLES)
def save_payout():
    save_payout_details(current_user()['id'], parse_bank(request.get_json(silent=True) or {}))
    get_db().commit()
    return get_payout()


@bp.delete('/payout')
@login_required(*PROPOSER_ROLES)
def delete_payout():
    db = get_db()
    db.execute('DELETE FROM payout_details WHERE user_id = ?', (current_user()['id'],))
    db.commit()
    return jsonify(payout=None)
